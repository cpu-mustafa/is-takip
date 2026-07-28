/*
 * Google Takvim entegrasyonu için ayarlar.
 * ------------------------------------------------------------
 * GOOGLE_CLIENT_ID doldurulmazsa uygulama yine tam çalışır:
 * "Takvime ekle" butonu, olayı önceden doldurulmuş Google Takvim
 * ekranında açar (tek tık ile kaydedersin). CLIENT_ID girersen
 * olaylar OTOMATİK olarak takvimine yazılır (README.md'deki adımlar).
 * ------------------------------------------------------------
 */
window.ISTAKIP_CONFIG = {
  // Google Cloud Console > "OAuth 2.0 Client ID" (Web application) değeri:
  GOOGLE_CLIENT_ID: "",

  // Etkinliklerin saat dilimi
  TIMEZONE: "Europe/Istanbul",

  // Bir görev takvime yazıldığında etkinlik kaç dakika sürsün (varsayılan süre)
  EVENT_DURATION_MIN: 60,

  // Otomatik hatırlatıcılar (popup = telefon + bilgisayar bildirimi).
  // minutes = etkinlikten kaç dakika önce.
  DEFAULT_REMINDERS: [
    { method: "popup", minutes: 1440 }, // 1 gün önce
    { method: "popup", minutes: 30 }    // 30 dakika önce
  ]
};
