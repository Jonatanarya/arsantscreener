package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jmoiron/sqlx"
)

type FundamentalsRow struct {
	Symbol            string    `db:"symbol"`
	MarketCap         *float64  `db:"market_cap"`
	PERatio           *float64  `db:"pe_ratio"`
	ForwardPE         *float64  `db:"forward_pe"`
	PegRatio          *float64  `db:"peg_ratio"`
	PriceToBook       *float64  `db:"price_to_book"`
	PriceToSales      *float64  `db:"price_to_sales"`
	BookValue         *float64  `db:"book_value"`
	EPSTrailing       *float64  `db:"eps_trailing"`
	EPSForward        *float64  `db:"eps_forward"`
	DividendYield     *float64  `db:"dividend_yield"`
	DividendRate      *float64  `db:"dividend_rate"`
	PayoutRatio       *float64  `db:"payout_ratio"`
	RevenueTTM        *float64  `db:"revenue_ttm"`
	RevenueGrowth     *float64  `db:"revenue_growth"`
	EarningsGrowth    *float64  `db:"earnings_growth"`
	ProfitMargin      *float64  `db:"profit_margin"`
	OperatingMargin   *float64  `db:"operating_margin"`
	ROE               *float64  `db:"roe"`
	ROA               *float64  `db:"roa"`
	TotalCash         *float64  `db:"total_cash"`
	TotalDebt         *float64  `db:"total_debt"`
	Beta              *float64  `db:"beta"`
	SharesOutstanding *int64    `db:"shares_outstanding"`
	Week52Low         *float64  `db:"week52_low"`
	Week52High        *float64  `db:"week52_high"`
	Week52Change      *float64  `db:"week52_change"`
	TargetMeanPrice   *float64  `db:"target_mean_price"`
	TargetHighPrice   *float64  `db:"target_high_price"`
	TargetLowPrice    *float64  `db:"target_low_price"`
	RecommendationKey *string   `db:"recommendation_key"`
	NumAnalysts       *int      `db:"num_analysts"`
	Currency          *string   `db:"currency"`
	FetchedAt         time.Time `db:"fetched_at"`
}

// GetFundamentals returns nil (no error) if the symbol has never been
// fetched — the caller decides whether that means "fetch now" or "no data
// available yet".
func GetFundamentals(db *sqlx.DB, symbol string) (*FundamentalsRow, error) {
	var row FundamentalsRow
	err := db.Get(&row, `SELECT * FROM fundamentals WHERE symbol = ?`, symbol)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get fundamentals: %w", err)
	}
	return &row, nil
}

func UpsertFundamentals(db *sqlx.DB, f FundamentalsRow) error {
	_, err := db.NamedExec(`
		INSERT INTO fundamentals (
			symbol, market_cap, pe_ratio, forward_pe, peg_ratio, price_to_book, price_to_sales,
			book_value, eps_trailing, eps_forward, dividend_yield, dividend_rate, payout_ratio,
			revenue_ttm, revenue_growth, earnings_growth, profit_margin, operating_margin,
			roe, roa, total_cash, total_debt, beta, shares_outstanding,
			week52_low, week52_high, week52_change,
			target_mean_price, target_high_price, target_low_price,
			recommendation_key, num_analysts, currency
		) VALUES (
			:symbol, :market_cap, :pe_ratio, :forward_pe, :peg_ratio, :price_to_book, :price_to_sales,
			:book_value, :eps_trailing, :eps_forward, :dividend_yield, :dividend_rate, :payout_ratio,
			:revenue_ttm, :revenue_growth, :earnings_growth, :profit_margin, :operating_margin,
			:roe, :roa, :total_cash, :total_debt, :beta, :shares_outstanding,
			:week52_low, :week52_high, :week52_change,
			:target_mean_price, :target_high_price, :target_low_price,
			:recommendation_key, :num_analysts, :currency
		)
		ON DUPLICATE KEY UPDATE
			market_cap = VALUES(market_cap), pe_ratio = VALUES(pe_ratio), forward_pe = VALUES(forward_pe),
			peg_ratio = VALUES(peg_ratio), price_to_book = VALUES(price_to_book), price_to_sales = VALUES(price_to_sales),
			book_value = VALUES(book_value), eps_trailing = VALUES(eps_trailing), eps_forward = VALUES(eps_forward),
			dividend_yield = VALUES(dividend_yield), dividend_rate = VALUES(dividend_rate), payout_ratio = VALUES(payout_ratio),
			revenue_ttm = VALUES(revenue_ttm), revenue_growth = VALUES(revenue_growth), earnings_growth = VALUES(earnings_growth),
			profit_margin = VALUES(profit_margin), operating_margin = VALUES(operating_margin),
			roe = VALUES(roe), roa = VALUES(roa), total_cash = VALUES(total_cash), total_debt = VALUES(total_debt),
			beta = VALUES(beta), shares_outstanding = VALUES(shares_outstanding),
			week52_low = VALUES(week52_low), week52_high = VALUES(week52_high), week52_change = VALUES(week52_change),
			target_mean_price = VALUES(target_mean_price), target_high_price = VALUES(target_high_price), target_low_price = VALUES(target_low_price),
			recommendation_key = VALUES(recommendation_key), num_analysts = VALUES(num_analysts), currency = VALUES(currency),
			fetched_at = CURRENT_TIMESTAMP
	`, f)
	if err != nil {
		return fmt.Errorf("upsert fundamentals: %w", err)
	}
	return nil
}
