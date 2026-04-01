/**
 * encryptionRoutes.js
 *
 * Provides endpoints for the frontend to retrieve the user's
 * encryption salt so it can derive the AES-256 encryption key
 * locally (zero-knowledge: the key never leaves the client or
 * crosses the network).
 *
 * Flow:
 *  REGISTER  → server generates salt → stores in DB → returns salt + derived key hint
 *  LOGIN     → server fetches salt   → returns it   → client derives key locally
 *  ENCRYPT   → client uses key to encrypt patient data before saving
 *  DECRYPT   → client uses key to decrypt patient data after fetching
 */

import express from 'express';
import { supabase, supabaseAdmin } from '../config/supabase.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { EncryptionService } from '../utils/encryptionService.js';

const router = express.Router();

// ---------------------------------------------------------------
// GET /api/encryption/salt
// Returns the authenticated user's encryption salt.
// The frontend uses this + the user's password to derive the AES key.
// ---------------------------------------------------------------
router.get('/salt', authenticateToken, async (req, res) => {
    try {
        const { userId, user_type } = req.user;
        const db = supabaseAdmin || supabase;

        // Try main users table first, then company_users
        let salt = null;
        let table = 'users';

        const { data: user } = await db
            .from('users')
            .select('id, encryption_salt')
            .eq('id', userId)
            .maybeSingle();

        if (user) {
            salt = user.encryption_salt;
        } else {
            const { data: companyUser } = await db
                .from('company_users')
                .select('id, encryption_salt')
                .eq('id', userId)
                .maybeSingle();

            if (companyUser) {
                salt = companyUser.encryption_salt;
                table = 'company_users';
            }
        }

        // If user has no salt yet (legacy account), generate one now
        if (!salt) {
            salt = EncryptionService.generateSalt();
            await db.from(table).update({ encryption_salt: salt }).eq('id', userId);
            console.log(`🔐 [Encryption] Generated new salt for legacy user ${userId}`);
        }

        return res.json({
            success: true,
            salt,
            message: 'Use this salt + your password with PBKDF2-SHA256 (10000 iterations, 32 bytes) to derive your AES-256 key.'
        });

    } catch (error) {
        console.error('❌ [Encryption] Error fetching salt:', error);
        res.status(500).json({ success: false, error: 'Failed to retrieve encryption salt' });
    }
});

// ---------------------------------------------------------------
// POST /api/encryption/verify
// Verifies that the client has correctly derived an encryption key
// by encrypting a known challenge with the key and sending it back.
// This is optional but useful for debugging key-derivation issues.
// ---------------------------------------------------------------
router.post('/verify', authenticateToken, async (req, res) => {
    try {
        const { challenge_encrypted, key_hex } = req.body;

        if (!challenge_encrypted || !key_hex) {
            return res.status(400).json({ success: false, error: 'challenge_encrypted and key_hex are required' });
        }

        const decrypted = EncryptionService.decrypt(challenge_encrypted, key_hex);

        return res.json({
            success: true,
            decrypted,
            key_valid: typeof decrypted === 'string' && decrypted.length > 0
        });

    } catch (error) {
        console.error('❌ [Encryption] Verify error:', error);
        res.status(500).json({ success: false, error: 'Key verification failed' });
    }
});

// ---------------------------------------------------------------
// POST /api/encryption/encrypt  (Server-side convenience — optional)
// Encrypts a value using the server-held key (use with caution:
// only for server-to-server scenarios where client can't encrypt).
// ---------------------------------------------------------------
router.post('/encrypt', authenticateToken, async (req, res) => {
    try {
        const { value, key_hex } = req.body;
        if (!value || !key_hex) {
            return res.status(400).json({ success: false, error: 'value and key_hex are required' });
        }

        const encrypted = EncryptionService.encrypt(value, key_hex);
        return res.json({ success: true, encrypted });

    } catch (error) {
        console.error('❌ [Encryption] Encrypt error:', error);
        res.status(500).json({ success: false, error: 'Encryption failed' });
    }
});

// ---------------------------------------------------------------
// POST /api/encryption/decrypt  (Server-side convenience — optional)
// ---------------------------------------------------------------
router.post('/decrypt', authenticateToken, async (req, res) => {
    try {
        const { encrypted_value, key_hex } = req.body;
        if (!encrypted_value || !key_hex) {
            return res.status(400).json({ success: false, error: 'encrypted_value and key_hex are required' });
        }

        const decrypted = EncryptionService.decrypt(encrypted_value, key_hex);
        return res.json({ success: true, decrypted });

    } catch (error) {
        console.error('❌ [Encryption] Decrypt error:', error);
        res.status(500).json({ success: false, error: 'Decryption failed' });
    }
});

export default router;
