import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri, AuthRequest } from 'expo-auth-session';
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPES,
} from '../../config';

const STORE_KEYS = {
  accessToken: 'spotify_access_token',
  refreshToken: 'spotify_refresh_token',
  tokenExpiry: 'spotify_token_expiry',
  userEmail: 'spotify_user_email',
} as const;

/**
 * Spotify OAuth2 PKCE Authentication Manager.
 *
 * Follows the auth-implementation-patterns skill:
 * - PKCE flow (no client_secret on device)
 * - Secure token storage via expo-secure-store
 * - Auto-refresh with 5-minute buffer
 * - Clean logout with full credential wipe
 */
export class SpotifyAuth {
  // ── Login Flow ──────────────────────────────────────────────────────────────

  /**
   * Initiates the full PKCE login flow:
   * 1. Generate code_verifier (128 chars) + SHA-256 code_challenge
   * 2. Open Spotify authorize URL in system browser
   * 3. Handle redirect callback with authorization code
   * 4. Exchange code for access + refresh tokens
   */
  public static async login(): Promise<boolean> {
    try {
      // 1. Generate PKCE code verifier (128 random bytes → base64url)
      const randomBytes = await Crypto.getRandomBytesAsync(96);
      const codeVerifier = this.base64UrlEncode(randomBytes);

      // 2. Derive SHA-256 code challenge
      const digest = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        codeVerifier,
        { encoding: Crypto.CryptoEncoding.BASE64 }
      );
      const codeChallenge = digest
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      // 3. Build authorization URL
      const authUrl = new URL('https://accounts.spotify.com/authorize');
      authUrl.searchParams.set('client_id', SPOTIFY_CLIENT_ID);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('redirect_uri', SPOTIFY_REDIRECT_URI);
      authUrl.searchParams.set('scope', SPOTIFY_SCOPES);
      authUrl.searchParams.set('code_challenge_method', 'S256');
      authUrl.searchParams.set('code_challenge', codeChallenge);

      // 4. Open browser for user consent
      console.log('[SpotifyAuth] Opening authorization browser...');
      const result = await WebBrowser.openAuthSessionAsync(
        authUrl.toString(),
        SPOTIFY_REDIRECT_URI
      );

      if (result.type !== 'success' || !result.url) {
        console.warn('[SpotifyAuth] Auth session cancelled or failed:', result.type);
        return false;
      }

      // 5. Extract authorization code from redirect URL
      const redirectUrl = new URL(result.url);
      const code = redirectUrl.searchParams.get('code');
      if (!code) {
        const error = redirectUrl.searchParams.get('error');
        console.error('[SpotifyAuth] No code in redirect. Error:', error);
        return false;
      }

      // 6. Exchange code for tokens
      console.log('[SpotifyAuth] Exchanging authorization code for tokens...');
      return await this.exchangeCodeForTokens(code, codeVerifier);
    } catch (error) {
      console.error('[SpotifyAuth] Login flow error:', error);
      return false;
    }
  }

  // ── Token Exchange ──────────────────────────────────────────────────────────

  private static async exchangeCodeForTokens(
    code: string,
    codeVerifier: string
  ): Promise<boolean> {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: SPOTIFY_CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: SPOTIFY_REDIRECT_URI,
        code_verifier: codeVerifier,
      }).toString(),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error('[SpotifyAuth] Token exchange failed:', errorData);
      return false;
    }

    const data = await response.json();
    await this.persistTokens(data.access_token, data.refresh_token, data.expires_in);
    console.log('[SpotifyAuth] Login successful. Tokens stored securely.');
    return true;
  }

  // ── Token Refresh ───────────────────────────────────────────────────────────

  /**
   * Returns a valid access token, auto-refreshing if expired.
   * Returns null if not logged in.
   */
  public static async getAccessToken(): Promise<string | null> {
    try {
      const accessToken = await SecureStore.getItemAsync(STORE_KEYS.accessToken);
      const refreshToken = await SecureStore.getItemAsync(STORE_KEYS.refreshToken);
      const expiry = await SecureStore.getItemAsync(STORE_KEYS.tokenExpiry);

      if (!accessToken || !refreshToken || !expiry) return null;

      // Refresh if within 5-minute buffer of expiring
      const isExpiring = Date.now() > Number(expiry) - 5 * 60 * 1000;
      if (isExpiring) {
        console.log('[SpotifyAuth] Token expiring soon, refreshing...');
        return await this.refreshAccessToken(refreshToken);
      }

      return accessToken;
    } catch (error) {
      console.warn('[SpotifyAuth] Error getting access token:', error);
      return null;
    }
  }

  private static async refreshAccessToken(refreshToken: string): Promise<string | null> {
    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: SPOTIFY_CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });

      if (!response.ok) {
        console.error('[SpotifyAuth] Refresh failed:', response.statusText);
        return null;
      }

      const data = await response.json();
      const newAccessToken = data.access_token;
      const newRefreshToken = data.refresh_token || refreshToken; // Spotify may rotate
      const expiresIn = data.expires_in;

      await this.persistTokens(newAccessToken, newRefreshToken, expiresIn);
      console.log('[SpotifyAuth] Token refreshed successfully.');
      return newAccessToken;
    } catch (error) {
      console.error('[SpotifyAuth] Refresh error:', error);
      return null;
    }
  }

  // ── State Queries ───────────────────────────────────────────────────────────

  /** Check if a Spotify session exists. */
  public static async isLoggedIn(): Promise<boolean> {
    const token = await SecureStore.getItemAsync(STORE_KEYS.accessToken);
    return !!token;
  }

  /** Get the connected Spotify account email. */
  public static async getUserEmail(): Promise<string | null> {
    return SecureStore.getItemAsync(STORE_KEYS.userEmail);
  }

  /** Store user email after first successful /me fetch. */
  public static async setUserEmail(email: string): Promise<void> {
    await SecureStore.setItemAsync(STORE_KEYS.userEmail, email);
  }

  // ── Logout ──────────────────────────────────────────────────────────────────

  /** Securely wipe all Spotify credentials. */
  public static async logout(): Promise<void> {
    for (const key of Object.values(STORE_KEYS)) {
      await SecureStore.deleteItemAsync(key);
    }
    console.log('[SpotifyAuth] All Spotify credentials wiped.');
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private static async persistTokens(
    accessToken: string,
    refreshToken: string,
    expiresIn: number
  ): Promise<void> {
    const expiry = Date.now() + expiresIn * 1000;
    await SecureStore.setItemAsync(STORE_KEYS.accessToken, accessToken);
    await SecureStore.setItemAsync(STORE_KEYS.refreshToken, refreshToken);
    await SecureStore.setItemAsync(STORE_KEYS.tokenExpiry, expiry.toString());
  }

  /** Convert Uint8Array to base64url string (RFC 4648 §5). */
  private static base64UrlEncode(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }
}
