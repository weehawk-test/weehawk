import { cleanEnv } from './env-string.util';

const DEFAULT_CALLBACK =
  'http://localhost:8080/login/oauth2/code/google';

export default () => ({
  google: {
    clientId: cleanEnv(process.env.GOOGLE_CLIENT_ID),
    clientSecret: cleanEnv(process.env.GOOGLE_CLIENT_SECRET),
    // Must match an "Authorized redirect URI" in Google Cloud (same path Passport sends as redirect_uri).
    callbackUrl: cleanEnv(process.env.GOOGLE_CALLBACK_URL) || DEFAULT_CALLBACK,
  },
});
