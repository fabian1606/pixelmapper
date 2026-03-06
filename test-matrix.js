const fs = require('fs');
const fixture = JSON.parse(fs.readFileSync('ofl-data/fixtures/american-dj/illusion-dotz-4-4.json', 'utf8'));

console.log(fixture.templateChannels);
