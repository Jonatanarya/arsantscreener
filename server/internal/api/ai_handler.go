package api

import (
	"fmt"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jmoiron/sqlx"

	"tradewise/server/internal/ai"
	"tradewise/server/internal/store"
)

// geminiClient is stateless (the API key travels per-request, never
// stored here) so one shared http.Client for connection reuse is fine.
var geminiClient = ai.NewGeminiClient()

func postAIOutlookHandler(db *sqlx.DB) fiber.Handler {
	return func(c *fiber.Ctx) error {
		symbol := strings.ToUpper(strings.TrimSpace(c.Params("symbol")))
		if symbol == "" {
			return badRequest(c, "symbol is required")
		}
		var req AIOutlookRequest
		if err := c.BodyParser(&req); err != nil {
			return badRequest(c, "invalid body: "+err.Error())
		}
		if strings.TrimSpace(req.APIKey) == "" {
			return badRequest(c, "apiKey is required")
		}

		prompt, err := buildOutlookPrompt(db, symbol)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(ErrorResponse{Error: err.Error()})
		}

		analysis, err := geminiClient.GenerateAnalysis(req.APIKey, prompt)
		if err != nil {
			return c.Status(fiber.StatusBadGateway).JSON(ErrorResponse{Error: err.Error()})
		}

		return c.JSON(AIOutlookResponse{
			Symbol: symbol, Analysis: analysis, GeneratedAt: time.Now().Format(time.RFC3339),
		})
	}
}

// buildOutlookPrompt gathers everything TradeWise Terminal already knows
// about symbol — Decision verdict (single source of truth, see
// computeDecision), fundamentals, dividends, financial statement trend,
// insider activity, catalysts, news, macro — into one Indonesian prompt
// for Gemini to narrate. Everything here is read from what's already
// cached in MySQL; generating an analysis never triggers new scraping of
// Stockbit/Yahoo.
func buildOutlookPrompt(db *sqlx.DB, symbol string) (string, error) {
	to := time.Now().Format("2006-01-02")
	from := time.Now().AddDate(0, -6, 0).Format("2006-01-02")

	var sb strings.Builder
	sb.WriteString("Kamu adalah analis saham profesional Bursa Efek Indonesia (BEI). ")
	sb.WriteString("Berdasarkan data berikut, tulis analisa singkat dan actionable dalam Bahasa Indonesia ")
	sb.WriteString("untuk saham " + symbol + ". Strukturkan jadi: (1) Ringkasan kondisi saat ini, ")
	sb.WriteString("(2) Kekuatan/katalis positif, (3) Risiko/hal yang perlu diwaspadai, ")
	sb.WriteString("(4) Kesimpulan & saran area entry/exit — sebagai alat bantu analisa, bukan rekomendasi ")
	sb.WriteString("finansial resmi. Gunakan bahasa yang jelas, hindari jargon berlebihan.\n\n")
	sb.WriteString("=== DATA " + symbol + " ===\n\n")

	// 1) Decision engine — verdict, skor, sinyal, rencana trading (satu
	// sumber kebenaran yang sama dengan panel Keputusan di web)
	if dec, err := computeDecision(db, symbol, from, to); err == nil {
		sb.WriteString(fmt.Sprintf("VERDICT SISTEM: %s (skor %d)\n", dec.Verdict, dec.Score))
		for _, s := range dec.Signals {
			sb.WriteString(fmt.Sprintf("- [%s] %s (%+d)\n", s.Source, s.Text, s.Points))
		}
		if dec.Plan != nil {
			sb.WriteString(fmt.Sprintf("Rencana trading sistem: Entry %.0f, SL %.0f, TP %.0f, ATR %.0f, R:R 1:%.1f\n",
				dec.Plan.Entry, dec.Plan.StopLoss, dec.Plan.TakeProfit, dec.Plan.ATR, dec.Plan.RiskReward))
		}
		sb.WriteString("\n")
	}

	// 2) Fundamental — cache Yahoo Finance + KeyStats Stockbit
	if f, err := store.GetFundamentals(db, symbol); err == nil && f != nil {
		sb.WriteString(fmt.Sprintf(
			"FUNDAMENTAL (Yahoo Finance): PER %.2f, PBV %.2f, ROE %.2f%%, Dividend Yield %.2f%%, Revenue Growth %.2f%%, Earnings Growth %.2f%%\n",
			deref(f.PERatio), deref(f.PriceToBook), deref(f.ROE)*100, deref(f.DividendYield)*100,
			deref(f.RevenueGrowth)*100, deref(f.EarningsGrowth)*100))
	}
	if ks, err := store.GetKeyStats(db, symbol); err == nil && ks != nil && ks.MarketCap > 0 {
		sb.WriteString(fmt.Sprintf("KEYSTATS (Stockbit): PER %.2f, PBV %.2f, ROE %.2f%%, ROA %.2f%%, DER %.2f, Market Cap %.0f\n",
			ks.PERatio, ks.PBVRatio, ks.ROE, ks.ROA, ks.DER, ks.MarketCap))
	}

	// 3) Dividen terakhir
	if divs, err := store.GetDividends(db, symbol); err == nil && len(divs) > 0 {
		sb.WriteString("DIVIDEN TERAKHIR:\n")
		for i, d := range divs {
			if i >= 3 {
				break
			}
			sb.WriteString(fmt.Sprintf("- Cum date %s, Rp %.2f/saham\n", d.CumDate, d.Amount))
		}
	}

	// 4) Tren laporan keuangan (Laba Rugi tahunan, item Revenue & Net
	// Profit saja supaya prompt tidak membengkak — cukup untuk tren)
	if fs, err := store.GetFinancialStatements(db, symbol, "income", "annual"); err == nil && len(fs) > 0 {
		sb.WriteString("TREN LAPORAN KEUANGAN (Laba Rugi Tahunan):\n")
		count := 0
		for _, item := range fs {
			lower := strings.ToLower(item.ItemName)
			if strings.Contains(lower, "revenue") || strings.Contains(lower, "penjualan") ||
				strings.Contains(lower, "net profit") || strings.Contains(lower, "laba bersih") {
				sb.WriteString(fmt.Sprintf("- %s (%s): %s = %.0f\n", item.Period, item.Currency, item.ItemName, item.Value))
				count++
				if count >= 10 {
					break
				}
			}
		}
	}

	// 5) Transaksi insider terakhir
	if txs, err := store.GetInsiderTransactions(db, symbol); err == nil && len(txs) > 0 {
		sb.WriteString("TRANSAKSI INSIDER TERAKHIR:\n")
		for i, t := range txs {
			if i >= 5 {
				break
			}
			sb.WriteString(fmt.Sprintf("- %s: %s %d lembar @ %.0f (%s)\n", t.TxDate, t.HolderName, t.Shares, t.Price, t.ActionType))
		}
	}

	// 6) Katalis Future Earnings
	if cats, err := store.ListCatalysts(db, symbol); err == nil && len(cats) > 0 {
		sb.WriteString("KATALIS:\n")
		for _, ct := range cats {
			period := ""
			if ct.ExpectedPeriod != nil {
				period = " (" + *ct.ExpectedPeriod + ")"
			}
			sb.WriteString(fmt.Sprintf("- [%s]%s %s: %s\n", ct.Impact, period, ct.Category, ct.Description))
		}
	}

	// 7) Berita terkait
	if news, err := store.ListNews(db, symbol, 8); err == nil && len(news) > 0 {
		sb.WriteString("BERITA TERKAIT:\n")
		for _, n := range news {
			sb.WriteString("- " + n.Title + "\n")
		}
	}

	// 8) Konteks makro
	if ihsg, err := store.GetMacroQuote(db, "^JKSE"); err == nil && ihsg != nil {
		sb.WriteString(fmt.Sprintf("MAKRO: IHSG %.2f (%+.2f%%)\n", ihsg.Price, ihsg.ChangePercent))
	}
	if usd, err := store.GetMacroQuote(db, "USDIDR=X"); err == nil && usd != nil {
		sb.WriteString(fmt.Sprintf("USD/IDR %.0f (%+.2f%%)\n", usd.Price, usd.ChangePercent))
	}

	return sb.String(), nil
}

func deref(v *float64) float64 {
	if v == nil {
		return 0
	}
	return *v
}
