import { convertHtml } from '../lib/snapshot-import.js';

const r1 = convertHtml('<p style="font-size:16px;color:#333">Hello world</p>');
console.log('=== plain p ===');
console.log('all count:', r1.all.length);
r1.all.forEach(n => console.log(' type:', n.type, 'text:', JSON.stringify(n.text), 'fills:', JSON.stringify(n.fills)));

const r2 = convertHtml('<p style="font-size:14px;color:#111">Normal <span style="font-weight:700">bold</span> and <span style="color:red">red</span></p>');
console.log('\n=== mixed spans ===');
console.log('all count:', r2.all.length);
r2.all.forEach(n => console.log(' type:', n.type, 'text:', JSON.stringify(n.text)));

const r3 = convertHtml('<div style="display:flex;flex-direction:row;gap:8px;padding:16px"><span style="font-size:14px">Child A</span><span style="font-size:14px">Child B</span></div>');
console.log('\n=== flex ===');
console.log('all count:', r3.all.length);
r3.all.forEach(n => console.log(' type:', n.type, 'flex:', JSON.stringify(n.flex)));

const r4 = convertHtml('<div style="background-color:#ff0000;width:100px;height:100px"></div>');
console.log('\n=== bg color ===');
r4.all.forEach(n => console.log(' type:', n.type, 'fills:', JSON.stringify(n.fills)));

const r5 = convertHtml('<div style="border-radius:8px;width:100px;height:100px;background:#ccc"></div>');
console.log('\n=== border-radius ===');
r5.all.forEach(n => console.log(' type:', n.type, 'radius:', JSON.stringify(n.radius)));

const r6 = convertHtml('<div style="box-shadow:0 2px 4px rgba(0,0,0,0.2);width:100px;height:100px;background:#fff"></div>');
console.log('\n=== box-shadow ===');
r6.all.forEach(n => console.log(' type:', n.type, 'shadows:', JSON.stringify(n.shadows)));

const r7 = convertHtml('<div style="opacity:0.5;width:100px;height:100px;background:#000"></div>');
console.log('\n=== opacity ===');
r7.all.forEach(n => console.log(' type:', n.type, 'opacity:', n.opacity));

const r8 = convertHtml('<p style="font-weight:700;font-size:16px">Bold text</p>');
console.log('\n=== font-weight ===');
r8.all.forEach(n => console.log(' type:', n.type, 'fontWeight:', n.text?.fontWeight));

const r9 = convertHtml('<div style="background:linear-gradient(to right,#ff0,#f00);width:100px;height:100px"></div>');
console.log('\n=== gradient ===');
r9.all.forEach(n => console.log(' type:', n.type, 'fills:', JSON.stringify(n.fills?.map(f => ({type: f.type, kind: f.kind})))));

const r10 = convertHtml('<p style="color:#ff0000;font-size:16px">Red text</p>');
console.log('\n=== text color ===');
r10.all.forEach(n => console.log(' type:', n.type, 'fills:', JSON.stringify(n.fills)));
