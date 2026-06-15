// Tide End-to-End API Test Script
// Run this script when wrangler dev is running locally at http://localhost:8788.

const BASE_URL = 'http://localhost:8788';

async function runTest() {
  console.log('=== STARTING TIDE E2E API VERIFICATION ===');
  
  // 1. Trigger login for a test user
  console.log('\n[1] Requesting magic link...');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test-e2e@example.com' })
  });

  if (!loginRes.ok) {
    throw new Error(`Login request failed with status ${loginRes.status}: ${await loginRes.text()}`);
  }

  const loginData = await loginRes.json();
  if (!loginData.success || !loginData.magicLink) {
    throw new Error(`Unexpected login response: ${JSON.stringify(loginData)}`);
  }
  console.log('✓ Magic link generated:', loginData.magicLink);

  // Parse login token
  const url = new URL(loginData.magicLink);
  const loginToken = url.searchParams.get('login_token');
  if (!loginToken) {
    throw new Error('Could not parse login_token from magic link');
  }

  // 2. Verify magic link token
  console.log('\n[2] Verifying login token...');
  const verifyRes = await fetch(`${BASE_URL}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: loginToken })
  });

  if (!verifyRes.ok) {
    throw new Error(`Verification failed with status ${verifyRes.status}: ${await verifyRes.text()}`);
  }

  const verifyData = await verifyRes.json();
  if (!verifyData.success || !verifyData.token || verifyData.email !== 'test-e2e@example.com') {
    throw new Error(`Unexpected verify response: ${JSON.stringify(verifyData)}`);
  }
  const sessionToken = verifyData.token;
  console.log('✓ Verification successful. Session token acquired:', sessionToken);

  // 3. Get empty integrations
  console.log('\n[3] Fetching initial integrations...');
  const getInitRes = await fetch(`${BASE_URL}/api/integrations`, {
    headers: { 'Authorization': `Bearer ${sessionToken}` }
  });
  if (!getInitRes.ok) {
    throw new Error(`GET integrations failed: ${getInitRes.status}`);
  }
  const initData = await getInitRes.json();
  console.log('✓ Initial integrations fetched. Jira site is empty:', initData.integrations.JIRA_SITE === '');

  // 4. Save integration keys
  console.log('\n[4] Saving integration keys...');
  const saveRes = await fetch(`${BASE_URL}/api/integrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sessionToken}`
    },
    body: JSON.stringify({
      keys: {
        JIRA_SITE: 'mycompany.atlassian.net',
        JIRA_EMAIL: 'me@company.com',
        JIRA_TOKEN: 'super-secret-jira-token',
        JIRA_PROJECT: 'PAY',
        FIGMA_TOKEN: 'figma-personal-access-token',
        FIGMA_FILES: 'figma-file-key-1'
      }
    })
  });
  if (!saveRes.ok) {
    throw new Error(`POST integrations failed: ${saveRes.status}`);
  }
  const saveData = await saveRes.json();
  if (!saveData.success) {
    throw new Error(`Save response unsuccessful: ${JSON.stringify(saveData)}`);
  }
  console.log('✓ Integrations saved successfully.');

  // 5. Fetch saved integrations and verify masking
  console.log('\n[5] Verifying key masking...');
  const getSavedRes = await fetch(`${BASE_URL}/api/integrations`, {
    headers: { 'Authorization': `Bearer ${sessionToken}` }
  });
  if (!getSavedRes.ok) {
    throw new Error(`GET saved integrations failed: ${getSavedRes.status}`);
  }
  const savedData = await getSavedRes.json();
  const integrations = savedData.integrations;

  if (integrations.JIRA_SITE !== 'mycompany.atlassian.net' || integrations.JIRA_PROJECT !== 'PAY') {
    throw new Error(`Saved details mismatched: ${JSON.stringify(integrations)}`);
  }
  if (integrations.JIRA_TOKEN !== '********' || integrations.FIGMA_TOKEN !== '********') {
    throw new Error(`Sensitive tokens were NOT masked! ${JSON.stringify(integrations)}`);
  }
  console.log('✓ Configuration retrieved correctly. Sensitive keys are masked (e.g. JIRA_TOKEN is "********").');

  // 6. Fetch dashboard feed
  console.log('\n[6] Fetching dashboard data...');
  const dashRes = await fetch(`${BASE_URL}/api/dashboard`, {
    headers: { 'Authorization': `Bearer ${sessionToken}` }
  });
  if (!dashRes.ok) {
    throw new Error(`GET dashboard failed: ${dashRes.status}`);
  }
  const dashData = await dashRes.json();
  if (!dashData.attention || !Array.isArray(dashData.attention)) {
    throw new Error(`Dashboard payload invalid shape: ${JSON.stringify(dashData)}`);
  }
  console.log('✓ Dashboard attention feed loaded. Item count:', dashData.attention.length);
  console.log('✓ Connected tools:', JSON.stringify(dashData._connected));
  console.log('✓ Fetch errors (expected due to mock tokens):', dashData._errors.length);

  // 7. Revoke session via logout
  console.log('\n[7] Logging out...');
  const logoutRes = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${sessionToken}` }
  });
  if (!logoutRes.ok) {
    throw new Error(`Logout request failed: ${logoutRes.status}`);
  }
  console.log('✓ Logged out.');

  // 8. Verify session is deleted
  console.log('\n[8] Verifying subsequent access is unauthorized...');
  const accessRes = await fetch(`${BASE_URL}/api/integrations`, {
    headers: { 'Authorization': `Bearer ${sessionToken}` }
  });
  if (accessRes.status !== 401) {
    throw new Error(`Access should be unauthorized (401), but got status ${accessRes.status}`);
  }
  console.log('✓ Access blocked with 401 Unauthorized.');

  console.log('\n===========================================');
  console.log('🎉 ALL E2E VERIFICATION TESTS PASSED SUCCESSFULLY! 🎉');
  console.log('===========================================');
}

runTest().catch(err => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
