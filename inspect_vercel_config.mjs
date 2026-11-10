import { readFileSync } from 'fs';

try {
    const f1 = readFileSync('c:\\Users\\wondewossenb\\Documents\\Addisfrontend\\vercel.json', 'utf8');
    console.log('--- Addisfrontend vercel.json ---');
    console.log(f1);
} catch (e) {
    console.log('No vercel.json in frontend:', e.message);
}

try {
    const f2 = readFileSync('c:\\Users\\wondewossenb\\Documents\\AddisBackend\\vercel.json', 'utf8');
    console.log('--- AddisBackend vercel.json ---');
    console.log(f2);
} catch (e) {
    console.log('No vercel.json in backend:', e.message);
}

try {
    const p1 = readFileSync('c:\\Users\\wondewossenb\\Documents\\Addisfrontend\\package.json', 'utf8');
    console.log('--- Addisfrontend package.json ---');
    console.log(JSON.parse(p1).scripts);
} catch (e) {}

try {
    const p2 = readFileSync('c:\\Users\\wondewossenb\\Documents\\AddisBackend\\package.json', 'utf8');
    console.log('--- AddisBackend package.json ---');
    console.log(JSON.parse(p2).scripts);
} catch (e) {}

