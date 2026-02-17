
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env vars
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

console.log('--- Email Configuration Check ---');
console.log(`Host: ${process.env.EMAIL_HOST}`);
console.log(`Port: ${process.env.EMAIL_PORT}`);
console.log(`User: ${process.env.EMAIL_USER}`);
// Mask password for security in logs
const pass = process.env.EMAIL_PASSWORD || '';
console.log(`Password (first 4 chars): ${pass.substring(0, 4)}...`);
console.log(`Password length: ${pass.length}`);

const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    }
});

const mailOptions = {
    from: `"Test Script" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_USER, // Send to self
    subject: 'Test Email from AddisBackend',
    text: 'If you receive this, the email configuration is working correctly.',
};

console.log('\nAttempting to send test email to self...');

transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
        console.error('❌ Error occurred:', error);
    } else {
        console.log('✅ Email sent successfully!');
        console.log('Message ID:', info.messageId);
        console.log('Response:', info.response);
    }
});
