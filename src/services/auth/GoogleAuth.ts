import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export class GoogleAuth {
  private static CLIENT_ID_IOS = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS || '';
  private static CLIENT_ID_ANDROID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID || '';

  /**
   * Retrieves a valid access token. Refreshes if expired or near expiry.
   */
  public static async getValidToken(): Promise<string | null> {
    try {
      const accessToken = await SecureStore.getItemAsync('google_access_token');
      const refreshToken = await SecureStore.getItemAsync('google_refresh_token');
      const expiry = await SecureStore.getItemAsync('google_token_expiry');

      if (!accessToken || !refreshToken || !expiry) {
        return null; // Not logged in
      }

      // Check if expired or within a 5-minute buffer of expiring
      const isExpired = Date.now() > Number(expiry) - 5 * 60 * 1000;
      if (isExpired) {
        console.log('[GoogleAuth] Access token expired or expiring soon. Refreshing...');
        return await this.refreshGoogleToken(refreshToken);
      }

      return accessToken;
    } catch (e) {
      console.warn('[GoogleAuth] Error getting valid token:', e);
      return null;
    }
  }

  /**
   * Performs OAuth2 token refresh with Google token endpoints.
   */
  private static async refreshGoogleToken(refreshToken: string): Promise<string | null> {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: Platform.OS === 'ios' ? this.CLIENT_ID_IOS : this.CLIENT_ID_ANDROID,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }).toString(),
      });

      if (!response.ok) {
        throw new Error(`Google token refresh failed: ${response.statusText}`);
      }

      const data = await response.json();
      const newAccessToken = data.access_token;
      const expiresIn = data.expires_in; // duration in seconds
      const newExpiry = Date.now() + expiresIn * 1000;

      // Save fresh access token and updated expiry time
      await SecureStore.setItemAsync('google_access_token', newAccessToken);
      await SecureStore.setItemAsync('google_token_expiry', newExpiry.toString());

      console.log('[GoogleAuth] Token refreshed successfully.');
      return newAccessToken;
    } catch (error) {
      console.error('[GoogleAuth] Error refreshing Google access token:', error);
      return null;
    }
  }

  /**
   * Helper to store credentials after successful login.
   */
  public static async saveCredentials(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
    const expiry = Date.now() + expiresIn * 1000;
    await SecureStore.setItemAsync('google_access_token', accessToken);
    await SecureStore.setItemAsync('google_refresh_token', refreshToken);
    await SecureStore.setItemAsync('google_token_expiry', expiry.toString());
  }

  /**
   * Clear credentials on logout.
   */
  public static async logout(): Promise<void> {
    await SecureStore.deleteItemAsync('google_access_token');
    await SecureStore.deleteItemAsync('google_refresh_token');
    await SecureStore.deleteItemAsync('google_token_expiry');
    console.log('[GoogleAuth] Securely wiped Google credentials.');
  }
}
