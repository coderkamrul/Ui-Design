import fs from 'fs';
import readline from 'readline';

async function findLine() {
  const fileStream = fs.createReadStream('C:/Users/h/.gemini/antigravity/brain/05eab66c-4a33-46de-82d6-52d18c2d2a36/.system_generated/logs/transcript_full.jsonl');
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  let lineNum = 0;
  let matches = [];
  for await (const line of rl) {
    lineNum++;
    if (line.includes('paper-snapshot-original-tag')) {
      matches.push({ lineNum, length: line.length });
    }
  }
  console.log('Matches:', matches.length);
  if (matches.length > 0) {
    console.log('Last match:', matches[matches.length - 1]);
    const targetLineNum = matches[matches.length - 1].lineNum;
    
    // Re-read and extract target line
    const stream2 = fs.createReadStream('C:/Users/h/.gemini/antigravity/brain/05eab66c-4a33-46de-82d6-52d18c2d2a36/.system_generated/logs/transcript_full.jsonl');
    const rl2 = readline.createInterface({ input: stream2, crlfDelay: Infinity });
    let curr = 0;
    for await (const l of rl2) {
      curr++;
      if (curr === targetLineNum) {
        const obj = JSON.parse(l);
        const text = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
        fs.writeFileSync('scripts/richmond_auto_raw.html', text, 'utf8');
        console.log('Wrote richmond_auto_raw.html with length:', text.length);
        break;
      }
    }
  }
}
findLine();
