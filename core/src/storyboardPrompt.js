'use strict';
const { L } = require('./labels');

const ROLE_ID = { depan: 'front', belakang: 'back', closeup: 'close-up', kemasan: 'package', label: 'label', samping: 'side', interior: 'interior', var: 'variation', sol: 'sole', isi_kotak: 'box contents', set: 'set contents', tekstur: 'texture', izin_klien: 'client-approved' };

function panelBlock(p) {
  const head = `PANEL ${String(p.n).padStart(2, '0')} | ${p.time_label} detik | header text: "${p.title}"`;
  const lines = [
    head,
    `  Shot: ${p.angle_prompt}`,
    `  Show: ${p.focus_en || p.focus}`,
    `  Under the photo write the heading "${L['L-07']}" and exactly these bullets, in Bahasa Indonesia:`,
    ...p.aksi.map(a => `   - ${a}`)
  ];
  return lines.join('\n');
}

function photoRoles(images) {
  return images.map((im, i) => `product photo ${i + 1} (${ROLE_ID[im.role] || im.role})`).join(', ');
}

/**
 * plan: hasil buildPanelPlan
 * ctx: { variant:'documented'|'clean', characterCode, productProfile, images:[{role}], layoutExample:boolean }
 */
function buildStoryboardPrompt(plan, ctx) {
  const { variant = 'documented', characterCode = '', productProfile, images = [], layoutExample = false } = ctx;
  // Varian bersih: gambar tanpa tulisan, jadi fakta memakai bahasa Inggris (facts_en). Varian bertulis: fakta Indonesia ditulis di gambar.
  const factList = variant === 'clean' ? (productProfile.facts_en || productProfile.facts || []) : (productProfile.facts || []);
  const facts = factList.map(f => `- ${f}`).join('\n') || '- (none verified)';
  const hex = (productProfile.colors || []).join(', ') || 'derive from the product references';
  const first = layoutExample ? 2 : 1;
  const imgLines = [];
  let n = 1;
  if (layoutExample) imgLines.push(`IMAGE ${n++} = LAYOUT EXAMPLE. Copy only its structure and level of detail. Never copy its product, colors, character, or text.`);
  imgLines.push(`IMAGE ${n++} = CHARACTER REFERENCE. The only source of the person's identity.`);
  imgLines.push(`IMAGES ${n} to ${n + Math.max(images.length - 1, 0)} = PRODUCT REFERENCES: ${photoRoles(images)}. All show ONE physical product (or one matching set). They are the source of truth, not inspiration.`);

  const common = `
IDENTITY: the character reference controls the person's identity (face, proportions, complexion, hairstyle, hair color, apparent age) in all five panels. Never take identity from any person, mannequin, or hand visible in product photos.

PRODUCT CONSISTENCY, HIGHEST PRIORITY: all five panels show the same physical product. A new angle, close-up, or pose never changes the product. Only natural folds and gravity may vary. If a detail is unclear or hidden, leave it out. If a close-up reference exists, it is the source of truth for that area. If a pose threatens fidelity, simplify the pose.

LOCATION (the same in all five panels): ${plan.setting.prompt_en} Lighting: ${plan.setting.lighting}. No signage, brand names, or readable text in the background.

VISUAL STYLE of the photos: highly realistic UGC, natural everyday look, realistic fabric or material texture, natural friendly expression, small natural gestures. Avoid cinematic light, luxury campaign look, runway pose, exaggerated movement, doll-like faces, and heavy retouching. No 360-degree spin.`;

  if (variant === 'clean') {
    return `Create ONE image: a clean horizontal strip of five vertical 9:16 photo panels side by side, for an EXACTLY 10-second UGC product review video. The image contains photographs only. No words, no letters, no numbers, no labels, no icons, no captions anywhere in the image. Panels are separated by thin plain gaps.

INPUT IMAGES, in this order:
${imgLines.join('\n')}

PANELS, left to right:
${plan.panels.map(p => `Panel ${p.n} (${p.time_label}s): ${p.angle_prompt} Show: ${p.focus_en || p.focus}.`).join('\n')}

PRODUCT FACTS (the only facts you may rely on):
${facts}
${common}

Generate the image now. Do not answer with text only and do not ask questions.`;
  }

  return `Create ONE complete portrait storyboard image (a production planning document, not a poster) for an EXACTLY 10-second vertical 9:16 UGC product review video.

INPUT IMAGES, in this order:
${imgLines.join('\n')}

LANGUAGE: every visible word is Bahasa Indonesia. Use ONLY the exact strings given below for titles and labels. Do not translate, paraphrase, or add any other label.
WORD RULE: use only neutral, production-focused wording everywhere in the image. No platform or app names, no marketing or sales wording, and no call-to-action wording anywhere in the image text. Do not draw any phone, camera, or app icons, pictograms, or device frames anywhere in the image.

HEADER: "${L['L-01']}". Subtitle: "${characterCode}". Top-right box: "${L['L-02a']}" and "${L['L-02b']}".

PANELS: five vertical panels, left to right, exactly as planned below. Number them 01 to 05 in order. No repeated or skipped number.
${plan.panels.map(panelBlock).join('\n\n')}

SECTIONS BELOW THE PANELS: "${L['L-08']}" with the character reference photo; "${L['L-09']}" with thumbnails of the product references; "${L['L-10']}" with 4-5 circular swatches matching ${hex}; "${L['L-11']}" with notes about the location (${plan.setting.name}), natural lighting, exact 10-second duration, and that the video shows only the character, the product, and the location; "${L['L-12']}" with notes written ONLY from the PRODUCT FACTS; and the footer "${L['L-13']}". No decorative illustrations.

PRODUCT FACTS (verified from the references; the only facts you may write):
${facts}
FORBIDDEN: any claim about material, comfort, softness, lightness, durability, price, discount, brand, or origin unless it appears in PRODUCT FACTS.
${common}

Generate the image now. Do not answer with text only and do not ask questions.`;
}

module.exports = { buildStoryboardPrompt };
