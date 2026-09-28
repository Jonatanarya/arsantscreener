package stockbitagent

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type BrokerRecord struct {
	BrokerCode   string
	Side         string
	Value        float64
	Lot          int64
	Frequency    int
	InvestorType string
}

func ParseBrokerSummary(payload json.RawMessage) ([]BrokerRecord, error) {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.UseNumber()
	var root any
	if err := decoder.Decode(&root); err != nil {
		return nil, fmt.Errorf("decode broker summary payload: %w", err)
	}
	summary := findBrokerSummary(root, 0)
	if summary == nil {
		return nil, fmt.Errorf("broker summary block is missing")
	}
	rows := make([]BrokerRecord, 0)
	rows = append(rows, parseSide(listValue(summary, "brokers_buy", "buyers"), "buy")...)
	rows = append(rows, parseSide(listValue(summary, "brokers_sell", "sellers"), "sell")...)
	if len(rows) == 0 {
		return nil, fmt.Errorf("broker summary contains no broker rows")
	}
	return rows, nil
}

func findBrokerSummary(value any, depth int) map[string]any {
	if depth > 7 {
		return nil
	}
	switch current := value.(type) {
	case map[string]any:
		if _, ok := current["brokers_buy"].([]any); ok {
			return current
		}
		if _, ok := current["brokers_sell"].([]any); ok {
			return current
		}
		if _, ok := current["buyers"].([]any); ok {
			return current
		}
		if _, ok := current["sellers"].([]any); ok {
			return current
		}
		for _, child := range current {
			if found := findBrokerSummary(child, depth+1); found != nil {
				return found
			}
		}
	case []any:
		for _, child := range current {
			if found := findBrokerSummary(child, depth+1); found != nil {
				return found
			}
		}
	}
	return nil
}

func listValue(value map[string]any, names ...string) []any {
	for _, name := range names {
		if rows, ok := value[name].([]any); ok {
			return rows
		}
	}
	return nil
}

func parseSide(input []any, side string) []BrokerRecord {
	byBroker := make(map[string]BrokerRecord)
	for _, item := range input {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		code := strings.ToUpper(strings.TrimSpace(textValue(row, "netbs_broker_code", "broker_code", "code", "broker")))
		if code == "" || code == "-" {
			continue
		}
		record := byBroker[code]
		record.BrokerCode = code
		record.Side = side
		investorType := strings.TrimSpace(textValue(row, "type", "investor_type", "domicile"))
		if investorType != "" {
			if record.InvestorType != "" && !strings.EqualFold(record.InvestorType, investorType) {
				record.InvestorType = "Campuran"
			} else {
				record.InvestorType = investorType
			}
		}
		if side == "buy" {
			record.Value += positiveValue(row["bval"], row["bvalv"])
			record.Lot += int64(positiveValue(row["blot"], row["blotv"]))
		} else {
			record.Value += positiveValue(row["sval"], row["svalv"])
			record.Lot += int64(positiveValue(row["slot"], row["slotv"]))
		}
		record.Frequency += int(numberValue(firstValue(row, "freq", "frequency")))
		byBroker[code] = record
	}
	rows := make([]BrokerRecord, 0, len(byBroker))
	for _, row := range byBroker {
		rows = append(rows, row)
	}
	return rows
}

func positiveValue(primary, fallback any) float64 {
	value := numberValue(primary)
	if value < 0 {
		if other := numberValue(fallback); other != 0 {
			return other
		}
		return -value
	}
	if value == 0 {
		return numberValue(fallback)
	}
	return value
}

func firstValue(row map[string]any, names ...string) any {
	for _, name := range names {
		if value, ok := row[name]; ok {
			return value
		}
	}
	return nil
}

func textValue(row map[string]any, names ...string) string {
	value := firstValue(row, names...)
	if value == nil {
		return ""
	}
	return fmt.Sprint(value)
}

func numberValue(value any) float64 {
	switch current := value.(type) {
	case json.Number:
		result, _ := current.Float64()
		return result
	case float64:
		return current
	case float32:
		return float64(current)
	case int:
		return float64(current)
	case int64:
		return float64(current)
	case string:
		clean := strings.ReplaceAll(strings.TrimSpace(current), ",", "")
		result, _ := strconv.ParseFloat(clean, 64)
		return result
	default:
		return 0
	}
}
