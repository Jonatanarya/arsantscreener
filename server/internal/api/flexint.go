package api

import (
	"encoding/json"
	"math"
)

// FlexInt64 and FlexInt unmarshal from a JSON number that may be an integer
// or a float (rounded to the nearest whole number). encoding/json rejects
// any JSON number with a fractional part when the destination is a plain
// int64/int, but bridge-extension's browser-side arithmetic can produce
// counts like 1500000.0000000002 for values that are conceptually whole
// (lot counts, frequency, volume) — reject-on-decimal-point there would
// just be a confusing "invalid JSON body" 400 for otherwise-good data.
type FlexInt64 int64

func (f *FlexInt64) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*f = 0
		return nil
	}
	var v float64
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*f = FlexInt64(math.Round(v))
	return nil
}

type FlexInt int

func (f *FlexInt) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*f = 0
		return nil
	}
	var v float64
	if err := json.Unmarshal(data, &v); err != nil {
		return err
	}
	*f = FlexInt(math.Round(v))
	return nil
}

// flexIntPtr/flexInt64Ptr convert the nil-able wire types back to plain
// int/int64 pointers for the store layer, preserving nil.
func flexIntPtr(f *FlexInt) *int {
	if f == nil {
		return nil
	}
	v := int(*f)
	return &v
}

func flexInt64Ptr(f *FlexInt64) *int64 {
	if f == nil {
		return nil
	}
	v := int64(*f)
	return &v
}
