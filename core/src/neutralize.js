'use strict';
// Mengganti istilah bertema tubuh pada fragmen prompt dengan padanan netral
// yang berfokus pada pakaian/produk dan framing. Hanya mengubah teks prompt,
// bukan makna framing.
const RULES = [
  [/\bmedium close-up as an? upper[- ]body shot\b/gi, 'Medium close-up shot'],   // tanpa ini hasilnya "Medium close-up as an medium close-up shot"
  [/\bfull[- ]body\b/gi, 'full-length'],
  [/\bhalf[- ]body\b/gi, 'half-length'],
  [/\bupper[- ]body\b/gi, 'medium close-up'],
  [/\bmid[- ]body height\b/gi, 'mid-frame height'],
  [/\bchest[- ]?(up|height)\b/gi, 'medium close-up framing'],
  [/\bwaist[- ]?up\b/gi, 'half-length framing'],
  [/turns her body/gi, 'turns slowly'],
  [/turns his body/gi, 'turns slowly'],
  [/\bbare surface\b/gi, 'plain surface'],
  [/\bbare\b/gi, 'plain'],
  [/\bbody proportions?\b/gi, 'proportions'],
  [/\bhuman anatomy\b/gi, 'natural proportions'],
  [/\bskin tone\b/gi, 'complexion'],
  [/\bskin texture\b/gi, 'face texture'],
  [/\bskin\b/gi, 'complexion'],
  [/\bbody\b/gi, 'frame']
];
function neutralize(text) {
  let out = String(text ?? '');
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}
module.exports = { neutralize };
