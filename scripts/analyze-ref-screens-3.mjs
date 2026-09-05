// Analyze the NEW Youform reference screenshots (shots 41-65 from zip #3)
// to extract field types + capabilities for the Field Expansion phase
import ZAI from 'z-ai-web-dev-sdk';
import fs from 'fs';
import path from 'path';

const dir = '/home/z/my-project/upload/youform-ref-3/youform screenshot';
const outPath = '/home/z/my-project/scripts/vlm-results-3.md';

const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.png'))
  .sort()
  .filter(f => {
    const n = parseInt(f.match(/shot_(\d+)/)?.[1] ?? '0', 10);
    return n >= 41; // only the new shots (41-65)
  });

const prompt = `You are analyzing a screenshot from the Youform form builder (a Typeform-like product). This is a REFERENCE for which field types / blocks exist and what settings each exposes.

Report EXACTLY in this format:
FIELD TYPE: <the field/block type being configured or shown>
SIDEBAR SETTINGS: <comma-separated list of EVERY setting name visible in the right sidebar/properties panel, include control type (toggle/text/select) and any visible values/options>
CANVAS PREVIEW: <one line describing how the field renders>
NOTES: <anything notable: validation options, special behaviors, layout options, left-panel entries visible>

Be literal and exhaustive about setting names. If multiple field types are visible in the left panel/block list, note them too.`;

async function main() {
  const zai = await ZAI.create();
  const results = [];
  for (const f of files) {
    const imgPath = path.join(dir, f);
    const base64 = fs.readFileSync(imgPath).toString('base64');
    try {
      const res = await zai.chat.completions.createVision({
        messages: [
          { role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}` } }
          ]}
        ],
        thinking: { type: 'disabled' }
      });
      const content = res.choices[0]?.message?.content || 'NO CONTENT';
      results.push(`### ${f}\n\n${content}\n`);
      console.log(`OK: ${f} -> ${content.slice(0, 80).replace(/\n/g, ' ')}`);
    } catch (e) {
      results.push(`### ${f}\n\nERROR: ${e.message}\n`);
      console.log(`ERR: ${f} -> ${e.message}`);
    }
    // write incrementally so partial progress is saved
    fs.writeFileSync(outPath, `# VLM analysis of NEW Youform reference screenshots (41-65)\n\n${results.join('\n---\n\n')}`);
  }
  console.log(`\nDONE. ${results.length} files analyzed. Output: ${outPath}`);
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
