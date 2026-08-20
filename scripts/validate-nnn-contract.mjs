import assert from 'node:assert/strict';
import {
  NNN_DEFAULT_COLORS,
  NNN_DEFAULT_NAVIGATION,
  NNN_NAVIGATION_CATALOG,
  builderReadiness,
  toNnnRegistryEntry,
  toNnnSiteCustomization,
} from '../server/nnn-contract.js';

assert.equal(NNN_NAVIGATION_CATALOG[0].id, 'dashboard');
assert.equal(NNN_NAVIGATION_CATALOG[0].required, true);
assert.equal(NNN_DEFAULT_NAVIGATION.length, 12);
assert.deepEqual(Object.keys(NNN_DEFAULT_COLORS).sort(), [
  'header_background', 'nav_background', 'nav_text', 'primary', 'secondary',
]);

const website = {
  site_key: 'demo-site-123',
  primary_domain: null,
};
const config = {
  brand_name: 'Demo Site',
  navigation: ['free_bots', 'dashboard', 'free_bots', 'unknown'],
  colors: { ...NNN_DEFAULT_COLORS, primary: '#0000FF' },
  deriv_client_id: '',
  deriv_scopes: ['trade', 'application_read'],
  deriv_environment: 'production',
};

const customization = toNnnSiteCustomization(website, config);
assert.deepEqual(customization.navigation, ['free_bots', 'dashboard']);
assert.equal(customization.colors.primary, '#0000ff');
assert.equal(customization.site_id, website.site_key);
assert.equal(toNnnRegistryEntry(website, config), null);
assert.equal(builderReadiness(website, config).configuration_ready, true);
assert.equal(builderReadiness(website, config).deployment_ready, false);

const deployableWebsite = { ...website, primary_domain: 'example.com' };
const deployableConfig = { ...config, deriv_client_id: '33ExampleClient123' };
const registry = toNnnRegistryEntry(deployableWebsite, deployableConfig);
assert.equal(registry?.id, website.site_key);
assert.deepEqual(registry?.hosts, ['example.com', 'www.example.com']);
assert.equal(registry?.redirect_uri, 'https://example.com/callback');
assert.equal(builderReadiness(deployableWebsite, deployableConfig).deployment_ready, true);

console.log('nnn builder contract validation passed.');
