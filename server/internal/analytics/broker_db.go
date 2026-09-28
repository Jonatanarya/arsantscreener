package analytics

import (
	"strings"
	"sync"
)

// Klasifikasi broker IDX (kode -> [nama, tipe]), di-port dari BROKER_DB di
// bridge-extension/app.js. tipe: asing | bumn | lokal-inst | ritel |
// ritel-online | campuran | lain.
var brokerDB = map[string][2]string{
	"AK": {"UBS Sekuritas Indonesia", "asing"},
	"BK": {"J.P. Morgan Sekuritas Indonesia", "asing"},
	"ZP": {"Maybank Sekuritas Indonesia", "asing"},
	"RX": {"Macquarie Sekuritas Indonesia", "asing"},
	"KZ": {"CLSA Sekuritas Indonesia", "asing"},
	"YU": {"CGS International Sekuritas", "asing"},
	"CG": {"Citigroup Sekuritas Indonesia", "asing"},
	"MS": {"Morgan Stanley Sekuritas", "asing"},
	"AI": {"UOB Kay Hian Sekuritas", "asing"},
	"BB": {"Verdhana Sekuritas Indonesia", "asing"},
	"DR": {"RHB Sekuritas Indonesia", "asing"},
	"TP": {"OCBC Sekuritas Indonesia", "asing"},
	"DB": {"Deutsche Sekuritas Indonesia", "asing"},
	"CC": {"Mandiri Sekuritas", "bumn"},
	"NI": {"BNI Sekuritas", "bumn"},
	"OD": {"BRI Danareksa Sekuritas", "bumn"},
	"DX": {"Bahana Sekuritas", "bumn"},
	"LG": {"Trimegah Sekuritas", "lokal-inst"},
	"IF": {"Samuel Sekuritas", "lokal-inst"},
	"AZ": {"Sucor Sekuritas", "lokal-inst"},
	"SQ": {"BCA Sekuritas", "lokal-inst"},
	"DH": {"Sinarmas Sekuritas", "lokal-inst"},
	"MG": {"Semesta Indovest Sekuritas", "lokal-inst"},
	"HP": {"Henan Putihrai Sekuritas", "lokal-inst"},
	"KI": {"Ciptadana Sekuritas Asia", "lokal-inst"},
	"LS": {"Reliance Sekuritas", "lokal-inst"},
	"PC": {"FAC Sekuritas", "lokal-inst"},
	"YP": {"Mirae Asset Sekuritas", "ritel-online"},
	"PD": {"Indo Premier Sekuritas", "ritel-online"},
	"XL": {"Stockbit Sekuritas", "ritel-online"},
	"XC": {"Ajaib Sekuritas Asia", "ritel-online"},
	"AG": {"Kiwoom Sekuritas Indonesia", "ritel-online"},
	"EP": {"MNC Sekuritas", "ritel"},
	"KK": {"Phillip Sekuritas Indonesia", "ritel"},
	"GR": {"Panin Sekuritas", "ritel"},
	"AT": {"Phintraco Sekuritas", "ritel"},
	"CP": {"KAF Sekuritas Indonesia", "ritel"},
	"SA": {"Elit Sukses Sekuritas", "ritel"},
	"XA": {"NH Korindo Sekuritas", "campuran"},
	"BQ": {"Korea Investment & Sekuritas", "campuran"},
	"FS": {"Yuanta Sekuritas Indonesia", "campuran"},
	"IH": {"Pacific Sekuritas Indonesia", "lain"},
	"FZ": {"Waterfront Sekuritas", "lain"},
	"ZR": {"Bumiputera Sekuritas", "lain"},
	"AO": {"Erdikha Elit Sekuritas", "lain"},
}

var smartWeight = map[string]float64{
	"asing":        1.0,
	"bumn":         0.75,
	"lokal-inst":   0.7,
	"campuran":     0.45,
	"lain":         0.35,
	"ritel":        0.15,
	"ritel-online": 0.1,
}

// Overlay master broker dari DATABASE (tabel `brokers`, diisi Data Collector
// dari daftar resmi Stockbit). Menjadi sumber utama NAMA dan golongan
// Asing/Lokal, menggantikan daftar hardcoded di atas.
//
// Kenapa daftar hardcoded tidak dihapus sama sekali: Stockbit hanya
// menyediakan group "Asing"/"Lokal". Klasifikasi lebih halus yang dipakai
// mesin smart-money (bumn / lokal-inst / ritel / ritel-online) TIDAK ada di
// data mana pun yang bisa ditarik, jadi tetap dari tabel di atas. DB melengkapi
// kode yang belum dikenal dan mengoreksi nama yang berubah.
var (
	brokerOverlayMu sync.RWMutex
	brokerOverlay   = map[string][2]string{} // code -> {nama, group Stockbit}
)

// SetBrokerOverlay dipanggil saat server start dan setiap kali master broker
// di-ingest ulang.
func SetBrokerOverlay(m map[string][2]string) {
	brokerOverlayMu.Lock()
	defer brokerOverlayMu.Unlock()
	brokerOverlay = m
}

func BrokerOverlaySize() int {
	brokerOverlayMu.RLock()
	defer brokerOverlayMu.RUnlock()
	return len(brokerOverlay)
}

func overlayGet(code string) ([2]string, bool) {
	brokerOverlayMu.RLock()
	defer brokerOverlayMu.RUnlock()
	v, ok := brokerOverlay[code]
	return v, ok
}

// BrokerName mengembalikan nama lengkap broker. Database menang atas daftar
// hardcoded; kode yang sama sekali tidak dikenal dikembalikan apa adanya.
func BrokerName(code string) string {
	if v, ok := overlayGet(code); ok && v[0] != "" {
		return v[0]
	}
	if v, ok := brokerDB[code]; ok {
		return v[0]
	}
	return code
}

// BrokerType mengklasifikasi kode broker untuk pembobotan smart money.
// Klasifikasi halus (bumn/lokal-inst/ritel) hanya ada di tabel hardcoded, jadi
// itu yang didahulukan; kode yang belum terdaftar di sana jatuh ke golongan
// dari database (Asing -> "asing"), lalu terakhir ke "lain".
func BrokerType(code string) string {
	if v, ok := brokerDB[code]; ok {
		return v[1]
	}
	if v, ok := overlayGet(code); ok {
		switch strings.ToLower(strings.TrimSpace(v[1])) {
		case "asing", "foreign":
			return "asing"
		case "lokal", "local", "domestic":
			return "lain"
		}
	}
	return "lain"
}

func brokerSmartWeight(code string) float64 {
	return smartWeight[BrokerType(code)]
}

// IsSmartBroker reports whether a broker code behaves institutionally
// (asing/bumn/lokal-inst — smart weight >= 0.7). Used by broker-analysis
// and decision endpoints to split smart-money vs retail flow.
func IsSmartBroker(code string) bool {
	return brokerSmartWeight(code) >= 0.7
}
