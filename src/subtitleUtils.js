// 🎬 Subtitle Generator -- konversi hasil transkripsi (segments dengan
// timestamp) jadi format .srt dan .vtt standar. Pure JS, tidak butuh AI/
// network apapun -- murni formatting, jadi bisa dipakai sama persis di
// mobile (React Native) maupun web (React) tanpa perubahan.
//
// ASUMSI PENTING: model Whisper yang dipanggil di Appwrite Function
// (lihat generate-subtitle/index.js) HARUS mengembalikan array `segments`
// dengan bentuk { start: number (detik), end: number (detik), text: string }
// -- ini format standar yang dipakai hampir semua implementasi Whisper di
// Replicate (openai/whisper, incredibly-fast-whisper, dst). Kalau ternyata
// modelmu cuma balikin teks polos tanpa timestamp per-segmen, .srt/.vtt
// TIDAK BISA dibikin dengan benar (subtitle wajib ada timing per baris) --
// perlu pastikan parameter model-nya diatur untuk return timestamps.

// SRT pakai koma buat pemisah milidetik: 00:00:01,500
function formatSrtTimestamp(totalSeconds) {
  const ms = Math.round((totalSeconds % 1) * 1000);
  const totalWholeSeconds = Math.floor(totalSeconds);
  const hours = Math.floor(totalWholeSeconds / 3600);
  const minutes = Math.floor((totalWholeSeconds % 3600) / 60);
  const seconds = totalWholeSeconds % 60;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(seconds, 2)},${pad(ms, 3)}`;
}

// VTT pakai titik buat pemisah milidetik: 00:00:01.500
function formatVttTimestamp(totalSeconds) {
  return formatSrtTimestamp(totalSeconds).replace(',', '.');
}

function pad(num, length) {
  return String(num).padStart(length, '0');
}

// 📄 Generate isi file .srt dari array segments.
export function segmentsToSrt(segments) {
  return segments
    .map((seg, index) => {
      const num = index + 1;
      const start = formatSrtTimestamp(seg.start);
      const end = formatSrtTimestamp(seg.end);
      const text = seg.text.trim();
      return `${num}\n${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
}

// 📄 Generate isi file .vtt dari array segments. Beda dari .srt: wajib
// diawali header "WEBVTT", timestamp pakai titik bukan koma.
export function segmentsToVtt(segments) {
  const body = segments
    .map((seg) => {
      const start = formatVttTimestamp(seg.start);
      const end = formatVttTimestamp(seg.end);
      const text = seg.text.trim();
      return `${start} --> ${end}\n${text}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

// 📝 Generate plain text transcript (buat preview di UI, tanpa timestamp).
export function segmentsToPlainText(segments) {
  return segments.map((seg) => seg.text.trim()).join(' ');
}