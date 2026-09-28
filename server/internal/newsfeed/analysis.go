package newsfeed

import (
	"regexp"
	"sort"
	"strings"
	"unicode"
)

type Company struct {
	Symbol string
	Name   string
}

type Impact struct {
	Symbol     string
	Sentiment  string
	Confidence float64
	Reason     string
}

type Analysis struct {
	Topic     string
	Sentiment string
	Impacts   []Impact
}

type Analyzer struct {
	companies []companyMatch
	symbols   map[string]struct{}
}

type companyMatch struct {
	symbol string
	name   string
	alias  []string
}

var symbolTokenPattern = regexp.MustCompile(`\b[A-Z][A-Z0-9]{3}\b`)

var companyAliases = map[string][]string{
	"BBCA": {"bca", "bank central asia"},
	"BBNI": {"bni", "bank negara indonesia"},
	"BBRI": {"bri", "bank rakyat indonesia"},
	"BMRI": {"bank mandiri"},
	"BRIS": {"bank syariah indonesia", "bsi"},
	"TLKM": {"telkom", "telkom indonesia"},
	"ASII": {"astra international"},
	"GOTO": {"goto", "gojek tokopedia"},
	"UNVR": {"unilever indonesia"},
	"ICBP": {"indofood cbp"},
	"INDF": {"indofood sukses makmur"},
	"ANTM": {"antam", "aneka tambang"},
	"PTBA": {"bukit asam"},
	"ADRO": {"alamtri resources", "adaro energy"},
	"PGAS": {"perusahaan gas negara", "pgn"},
	"JSMR": {"jasa marga"},
	"KLBF": {"kalbe farma"},
}

func NewAnalyzer(companies []Company) *Analyzer {
	a := &Analyzer{symbols: make(map[string]struct{}), companies: make([]companyMatch, 0, len(companies))}
	for _, company := range companies {
		symbol := strings.ToUpper(strings.TrimSpace(company.Symbol))
		if symbol == "" {
			continue
		}
		a.symbols[symbol] = struct{}{}
		name := normalize(company.Name)
		aliases := append([]string(nil), companyAliases[symbol]...)
		if name != "" && name != strings.ToLower(symbol) && len([]rune(name)) >= 6 {
			aliases = append(aliases, name)
		}
		for i := range aliases {
			aliases[i] = normalize(aliases[i])
		}
		a.companies = append(a.companies, companyMatch{symbol: symbol, name: name, alias: aliases})
	}
	return a
}

func (a *Analyzer) Analyze(title, summary string) Analysis {
	text := strings.TrimSpace(title + " " + summary)
	lower := strings.ToLower(text)
	sentiment, confidence, reason := classifySentiment(lower, strings.ToLower(title))
	topic := classifyTopic(lower)
	matched := make(map[string]struct{})
	// Ticker must be explicit in the source text. Uppercasing the whole article
	// would turn ordinary Indonesian words such as "Kota" or "Daya" into valid
	// IDX symbols (KOTA/DAYA) and create false impact labels. Impact extraction
	// intentionally uses the headline: a ticker in the summary may only identify
	// an analyst or quoted broker, not the company affected by the news.
	for _, token := range symbolTokenPattern.FindAllString(title, -1) {
		if _, ok := a.symbols[token]; ok {
			matched[token] = struct{}{}
		}
	}
	normalizedText := " " + normalize(title) + " "
	for _, company := range a.companies {
		for _, alias := range company.alias {
			if alias != "" && strings.Contains(normalizedText, " "+alias+" ") {
				matched[company.symbol] = struct{}{}
				break
			}
		}
	}
	impacts := make([]Impact, 0, len(matched))
	for symbol := range matched {
		impacts = append(impacts, Impact{
			Symbol: symbol, Sentiment: sentiment, Confidence: confidence, Reason: reason,
		})
	}
	sort.Slice(impacts, func(i, j int) bool { return impacts[i].Symbol < impacts[j].Symbol })
	return Analysis{Topic: topic, Sentiment: sentiment, Impacts: impacts}
}

var positivePhrases = []string{
	"laba naik", "laba tumbuh", "laba melonjak", "pendapatan naik", "pendapatan tumbuh",
	"membagikan dividen", "dividen tunai", "buyback", "pembelian kembali saham",
	"kontrak baru", "ekspansi", "akuisisi", "target naik", "rekomendasi beli",
	"naik peringkat", "upgrade", "surplus", "melunasi utang", "kinerja positif",
	"cetak rekor", "harga menguat", "saham menguat", "menguat", "melonjak",
}

var negativePhrases = []string{
	"mencatat rugi", "merugi", "laba turun", "laba merosot", "pendapatan turun",
	"suspensi", "gagal bayar", "default", "gugatan", "pailit", "pemutusan hubungan kerja",
	"phk", "denda", "turun peringkat", "downgrade", "koreksi target", "harga anjlok",
	"saham anjlok", "saham merosot", "tersandung kasus", "terancam sanksi", "melemah", "anjlok",
}

func classifySentiment(text, title string) (string, float64, string) {
	positive, negative := 0, 0
	positiveReason, negativeReason := "", ""
	for _, phrase := range positivePhrases {
		if strings.Contains(text, phrase) {
			positive++
			if strings.Contains(title, phrase) {
				positive++
			}
			if positiveReason == "" {
				positiveReason = phrase
			}
		}
	}
	for _, phrase := range negativePhrases {
		if strings.Contains(text, phrase) {
			negative++
			if strings.Contains(title, phrase) {
				negative++
			}
			if negativeReason == "" {
				negativeReason = phrase
			}
		}
	}
	if positive == negative {
		return "NETRAL", 50, "tidak ada sinyal sentimen dominan"
	}
	difference := positive - negative
	if difference < 0 {
		difference = -difference
	}
	confidence := 60 + float64(difference-1)*10
	if confidence > 95 {
		confidence = 95
	}
	if positive > negative {
		return "POSITIF", confidence, positiveReason
	}
	return "NEGATIF", confidence, negativeReason
}

func classifyTopic(text string) string {
	topics := []struct {
		name     string
		keywords []string
	}{
		{"KORPORASI", []string{"emiten", "dividen", "akuisisi", "merger", "right issue", "ipo", "buyback", "rapat umum pemegang saham", "rups"}},
		{"PERBANKAN", []string{"bank", "kredit", "suku bunga", "bi rate", "pinjaman"}},
		{"KOMODITAS", []string{"minyak", "emas", "batubara", "batu bara", "nikel", "timah", "tembaga", "cpo"}},
		{"MAKRO", []string{"inflasi", "rupiah", "pdb", "ekonomi indonesia", "anggaran", "apbn", "bank indonesia"}},
		{"BURSA", []string{"ihsg", "bursa", "saham", "indeks harga saham", "bei"}},
	}
	bestTopic, bestScore := "MARKET", 0
	for _, topic := range topics {
		score := 0
		for _, keyword := range topic.keywords {
			if strings.Contains(text, keyword) {
				score++
			}
		}
		if score > bestScore {
			bestTopic, bestScore = topic.name, score
		}
	}
	return bestTopic
}

func normalize(value string) string {
	value = strings.ToLower(value)
	var builder strings.Builder
	for _, r := range value {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			builder.WriteRune(r)
		} else {
			builder.WriteByte(' ')
		}
	}
	parts := strings.Fields(builder.String())
	filtered := parts[:0]
	for _, part := range parts {
		switch part {
		case "pt", "tbk", "persero", "terbuka":
			continue
		default:
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, " ")
}
