const crypto = require('crypto');

// Generate a secure random secret for NextAuth
const secret = crypto.randomBytes(32).toString('base64');

console.log('Generated NextAuth Secret:');
console.log(secret);
console.log('\nAdd this to your Vercel environment variables as NEXTAUTH_SECRET');
console.log('Or run: openssl rand -base64 32'); 