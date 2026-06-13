const fs = require('fs');
const path = require('path');

const scriptsDir = __dirname;
const rootDir = path.join(scriptsDir, '..');
const audioDir = path.join(rootDir, 'audio');
const config = {};
let totalSounds = 0;

const items = fs.readdirSync(audioDir);

items.forEach(item => {
    const itemPath = path.join(audioDir, item);
    const stat = fs.statSync(itemPath);
    
    if (stat.isDirectory()) {
        const files = fs.readdirSync(itemPath);
        const audioFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus'].includes(ext);
        }).sort();
        
        if (audioFiles.length > 0) {
            config[item] = audioFiles.map(file => {
                const filePath = path.join(itemPath, file);
                let size = 0;
                try { size = fs.statSync(filePath).size; } catch (e) {}
                return [file, size];
            });
            console.log('✓ ' + item + ': ' + audioFiles.length + ' sounds');
            totalSounds += audioFiles.length;
        }
    }
});

var jsContent = 'window.SOUND_CONFIG = ' + JSON.stringify(config) + ';';
fs.writeFileSync(path.join(rootDir, 'config.js'), jsContent);

console.log('');
console.log('✓ config.js generated!');
console.log('✓ Total sounds: ' + totalSounds);

var oldJson = path.join(rootDir, 'config.json');
if (fs.existsSync(oldJson)) {
    fs.unlinkSync(oldJson);
}
