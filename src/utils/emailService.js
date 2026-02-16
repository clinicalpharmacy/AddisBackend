import nodemailer from 'nodemailer';
import { config } from '../config/env.js';

// Create reusable transporter
const createTransporter = () => {
    return nodemailer.createTransport({
        host: config.emailHost || 'smtp.gmail.com',
        port: config.emailPort || 587,
        secure: false, // true for 465, false for other ports
        auth: {
            user: config.emailUser,
            pass: config.emailPassword
        }
    });
};

/**
 * Send verification email to user
 * @param {string} email - User's email address
 * @param {string} name - User's full name
 * @param {string} verificationToken - Verification token
 * @returns {Promise<boolean>} - Success status
 */
export const sendVerificationEmail = async (email, name, verificationToken) => {
    try {
        const transporter = createTransporter();
        
        const verificationUrl = `${config.frontendUrl}/verify-email?token=${verificationToken}`;
        
        const mailOptions = {
            from: `"Addis Clinical Pharmacy" <${config.emailUser}>`,
            to: email,
            subject: 'Verify Your Email - Addis Clinical Pharmacy',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                            color: #333;
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                        }
                        .header {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            padding: 30px;
                            text-align: center;
                            border-radius: 10px 10px 0 0;
                        }
                        .content {
                            background: #f9f9f9;
                            padding: 30px;
                            border-radius: 0 0 10px 10px;
                        }
                        .button {
                            display: inline-block;
                            padding: 15px 30px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 5px;
                            margin: 20px 0;
                            font-weight: bold;
                        }
                        .footer {
                            text-align: center;
                            margin-top: 30px;
                            padding-top: 20px;
                            border-top: 1px solid #ddd;
                            color: #666;
                            font-size: 12px;
                        }
                        .warning {
                            background: #fff3cd;
                            border-left: 4px solid #ffc107;
                            padding: 15px;
                            margin: 20px 0;
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>Welcome to Addis Clinical Pharmacy!</h1>
                    </div>
                    <div class="content">
                        <h2>Hello ${name},</h2>
                        <p>Thank you for registering with Addis Clinical Pharmacy. We're excited to have you on board!</p>
                        <p>To complete your registration and activate your account, please verify your email address by clicking the button below:</p>
                        
                        <div style="text-align: center;">
                            <a href="${verificationUrl}" class="button">Verify Email Address</a>
                        </div>
                        
                        <p>Or copy and paste this link into your browser:</p>
                        <p style="word-break: break-all; background: white; padding: 10px; border-radius: 5px;">
                            ${verificationUrl}
                        </p>
                        
                        <div class="warning">
                            <strong>⚠️ Important:</strong> This verification link will expire in 24 hours. If you didn't create an account with us, please ignore this email.
                        </div>
                        
                        <p>If you have any questions or need assistance, please don't hesitate to contact our support team.</p>
                        
                        <p>Best regards,<br>
                        <strong>The Addis Clinical Pharmacy Team</strong></p>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Addis Clinical Pharmacy. All rights reserved.</p>
                        <p>This is an automated email. Please do not reply to this message.</p>
                    </div>
                </body>
                </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Verification email sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('❌ Error sending verification email:', error);
        return false;
    }
};

/**
 * Send password reset email
 * @param {string} email - User's email address
 * @param {string} name - User's full name
 * @param {string} resetToken - Password reset token
 * @returns {Promise<boolean>} - Success status
 */
export const sendPasswordResetEmail = async (email, name, resetToken) => {
    try {
        const transporter = createTransporter();
        
        const resetUrl = `${config.frontendUrl}/reset-password?token=${resetToken}`;
        
        const mailOptions = {
            from: `"Addis Clinical Pharmacy" <${config.emailUser}>`,
            to: email,
            subject: 'Password Reset Request - Addis Clinical Pharmacy',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                            color: #333;
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                        }
                        .header {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            padding: 30px;
                            text-align: center;
                            border-radius: 10px 10px 0 0;
                        }
                        .content {
                            background: #f9f9f9;
                            padding: 30px;
                            border-radius: 0 0 10px 10px;
                        }
                        .button {
                            display: inline-block;
                            padding: 15px 30px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 5px;
                            margin: 20px 0;
                            font-weight: bold;
                        }
                        .footer {
                            text-align: center;
                            margin-top: 30px;
                            padding-top: 20px;
                            border-top: 1px solid #ddd;
                            color: #666;
                            font-size: 12px;
                        }
                        .warning {
                            background: #fff3cd;
                            border-left: 4px solid #ffc107;
                            padding: 15px;
                            margin: 20px 0;
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>Password Reset Request</h1>
                    </div>
                    <div class="content">
                        <h2>Hello ${name},</h2>
                        <p>We received a request to reset your password for your Addis Clinical Pharmacy account.</p>
                        <p>Click the button below to reset your password:</p>
                        
                        <div style="text-align: center;">
                            <a href="${resetUrl}" class="button">Reset Password</a>
                        </div>
                        
                        <p>Or copy and paste this link into your browser:</p>
                        <p style="word-break: break-all; background: white; padding: 10px; border-radius: 5px;">
                            ${resetUrl}
                        </p>
                        
                        <div class="warning">
                            <strong>⚠️ Important:</strong> This password reset link will expire in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                        </div>
                        
                        <p>Best regards,<br>
                        <strong>The Addis Clinical Pharmacy Team</strong></p>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Addis Clinical Pharmacy. All rights reserved.</p>
                        <p>This is an automated email. Please do not reply to this message.</p>
                    </div>
                </body>
                </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Password reset email sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('❌ Error sending password reset email:', error);
        return false;
    }
};

/**
 * Send welcome email after email verification
 * @param {string} email - User's email address
 * @param {string} name - User's full name
 * @returns {Promise<boolean>} - Success status
 */
export const sendWelcomeEmail = async (email, name) => {
    try {
        const transporter = createTransporter();
        
        const mailOptions = {
            from: `"Addis Clinical Pharmacy" <${config.emailUser}>`,
            to: email,
            subject: 'Welcome to Addis Clinical Pharmacy!',
            html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                            color: #333;
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                        }
                        .header {
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            padding: 30px;
                            text-align: center;
                            border-radius: 10px 10px 0 0;
                        }
                        .content {
                            background: #f9f9f9;
                            padding: 30px;
                            border-radius: 0 0 10px 10px;
                        }
                        .button {
                            display: inline-block;
                            padding: 15px 30px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 5px;
                            margin: 20px 0;
                            font-weight: bold;
                        }
                        .footer {
                            text-align: center;
                            margin-top: 30px;
                            padding-top: 20px;
                            border-top: 1px solid #ddd;
                            color: #666;
                            font-size: 12px;
                        }
                        .feature {
                            background: white;
                            padding: 15px;
                            margin: 10px 0;
                            border-radius: 5px;
                            border-left: 4px solid #667eea;
                        }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>🎉 Welcome Aboard!</h1>
                    </div>
                    <div class="content">
                        <h2>Hello ${name},</h2>
                        <p>Your email has been successfully verified! Welcome to Addis Clinical Pharmacy.</p>
                        
                        <p>Your account is now pending approval from our admin team. Once approved, you'll have access to:</p>
                        
                        <div class="feature">
                            <strong>📚 Comprehensive Medication Knowledge Base</strong>
                            <p>Access detailed information about medications, interactions, and clinical guidelines.</p>
                        </div>
                        
                        <div class="feature">
                            <strong>👥 Patient Management System</strong>
                            <p>Efficiently manage patient records and medication histories.</p>
                        </div>
                        
                        <div class="feature">
                            <strong>🔍 Clinical Decision Support</strong>
                            <p>Get real-time alerts and recommendations for safer prescribing.</p>
                        </div>
                        
                        <div class="feature">
                            <strong>📊 Analytics & Reporting</strong>
                            <p>Track performance and generate insightful reports.</p>
                        </div>
                        
                        <p>We'll notify you as soon as your account is approved. In the meantime, if you have any questions, feel free to reach out to our support team.</p>
                        
                        <div style="text-align: center;">
                            <a href="${config.frontendUrl}/login" class="button">Go to Login</a>
                        </div>
                        
                        <p>Best regards,<br>
                        <strong>The Addis Clinical Pharmacy Team</strong></p>
                    </div>
                    <div class="footer">
                        <p>© ${new Date().getFullYear()} Addis Clinical Pharmacy. All rights reserved.</p>
                    </div>
                </body>
                </html>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Welcome email sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('❌ Error sending welcome email:', error);
        return false;
    }
};
