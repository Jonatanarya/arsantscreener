package alerts

import (
	"tradewise/server/internal/analytics"
	"tradewise/server/internal/store"
)

// reshapeBrokerRows mirrors internal/api's helper of the same name — kept
// as a small local copy rather than an exported cross-package dependency
// since it's ~15 lines and this is the only other caller.
func reshapeBrokerRows(rows []store.BrokerSummaryRangeRow) map[string][]analytics.BrokerDayFlow {
	byDate := map[string]map[string]*analytics.BrokerDayFlow{}
	for _, r := range rows {
		date := r.DateStr()
		brokers := byDate[date]
		if brokers == nil {
			brokers = map[string]*analytics.BrokerDayFlow{}
			byDate[date] = brokers
		}
		f := brokers[r.BrokerCode]
		if f == nil {
			f = &analytics.BrokerDayFlow{Code: r.BrokerCode}
			brokers[r.BrokerCode] = f
		}
		switch r.Side {
		case "buy":
			f.BuyValue, f.BuyLot, f.BuyFreq = r.Value, r.Lot, r.Freq
		case "sell":
			f.SellValue, f.SellLot, f.SellFreq = r.Value, r.Lot, r.Freq
		}
	}

	out := make(map[string][]analytics.BrokerDayFlow, len(byDate))
	for date, brokers := range byDate {
		flows := make([]analytics.BrokerDayFlow, 0, len(brokers))
		for _, f := range brokers {
			flows = append(flows, *f)
		}
		out[date] = flows
	}
	return out
}
