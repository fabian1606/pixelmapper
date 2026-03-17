import fs from 'fs';

// Read actual firmware
const binData = fs.readFileSync("pio/.pio/build/waveshare_p4_poe/firmware.bin");

function bstrToUi8(bStr) {
    const u8Array = new Uint8Array(bStr.length);
    for (let i = 0; i < bStr.length; i++) {
        u8Array[i] = bStr.charCodeAt(i);
    }
    return u8Array;
}

// Emulate current buggy code
let binary = '';
const bytes = new Uint8Array(binData);
for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
}
console.log("String.fromCharCode parsing:");
console.log("Original parsed back:", Buffer.compare(Buffer.from(bstrToUi8(binary)), binData) === 0);

// Let's emulate what other code does:
const binary2 = binData.toString('binary');
console.log("Buffer.toString('binary') parsing:");
console.log("Original parsed back:", Buffer.compare(Buffer.from(bstrToUi8(binary2)), binData) === 0);
