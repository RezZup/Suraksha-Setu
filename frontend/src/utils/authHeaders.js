const toBase64Url = (value) => {
  try {
    const encoded = window.btoa(unescape(encodeURIComponent(value)));
    return encoded.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  } catch {
    return '';
  }
};

const createLocalDevToken = (role = 'admin') => {
  let email = 'dev@suraksha.local';
  let uid = 'local_dev_user';
  let name = 'Local Developer';

  try {
    const rawUser = localStorage.getItem('auth_user');
    if (rawUser) {
      const parsed = JSON.parse(rawUser);
      email = parsed?.email || email;
      uid = parsed?.id || parsed?.uid || uid;
      name = parsed?.name || parsed?.full_name || name;
    }
  } catch {
    // Keep default local dev identity if auth_user is malformed.
  }

  const header = toBase64Url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = toBase64Url(
    JSON.stringify({
      uid,
      email,
      name,
      role,
      user_type: role,
      email_verified: true,
      dev_unverified: true,
      iat: Math.floor(Date.now() / 1000),
    })
  );

  return header && payload ? `${header}.${payload}.` : '';
};

export const getAuthHeadersForApi = (apiUrl, role = 'admin') => {
  const existingToken = localStorage.getItem('auth_token') || '';
  if (existingToken) {
    return { Authorization: `Bearer ${existingToken}` };
  }

  const isLocalApi = /localhost|127\.0\.0\.1/.test(apiUrl || '');
  const isDevBuild = process.env.NODE_ENV !== 'production';
  if (!isLocalApi || !isDevBuild) {
    return {};
  }

  const devToken = createLocalDevToken(role);
  if (!devToken) {
    return {};
  }

  return { Authorization: `Bearer ${devToken}` };
};
