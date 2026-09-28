package api

import "tradewise/server/internal/analytics"

func toPhaseResponse(p analytics.Phase) Phase {
	top := make([]PhaseBrokerNet, len(p.TopBrokers))
	for j, b := range p.TopBrokers {
		top[j] = PhaseBrokerNet{Code: b.Code, Net: b.Net}
	}
	return Phase{
		Type: string(p.Type), Actor: string(p.Actor),
		AvgTrx: p.AvgTrx, AvgPrice: p.AvgPrice,
		FromDate: p.FromDate, ToDate: p.ToDate,
		PriceLow: p.PriceLow, PriceHigh: p.PriceHigh,
		TopBrokers: top, Flow: p.Flow, SmartShare: p.SmartShare,
		Days: p.Days,
	}
}

func toClimaxResponse(c *analytics.Climax) *Climax {
	if c == nil {
		return nil
	}
	return &Climax{Type: c.Type, Desc: c.Desc, Date: c.Date}
}
