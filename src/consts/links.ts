import { config } from './config';

// Serve chain logos from the configured GitHub registry so custom chains get their logos;
// falls back to the canonical registry for any other registry URL.
function registryImgPath(): string {
  const match = config.registryUrl?.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/);
  if (!match) return 'https://cdn.jsdelivr.net/gh/hyperlane-xyz/hyperlane-registry@main';
  return `https://cdn.jsdelivr.net/gh/${match[1]}/${match[2]}@${config.registryBranch || 'main'}`;
}

export const links = {
  baseUrl: 'https://www.hyperlane.xyz',
  explorerUrl: 'https://explorer.hyperlane.xyz',
  home: 'https://www.hyperlane.xyz',
  help: 'https://help.hyperlane.xyz',
  discord: 'https://discord.gg/VK9ZUy3aTV',
  github: 'https://github.com/hyperlane-xyz',
  jobs: 'https://jobs.lever.co/Hyperlane',
  stake: 'https://app.symbiotic.fi/vault/0xE1F23869776c82f691d9Cb34597Ab1830Fb0De58',
  twitter: 'https://x.com/hyperlane',
  blog: 'https://medium.com/hyperlane',
  tenderlySimDocs:
    'https://docs.tenderly.co/simulations-and-forks/how-to-simulate-a-transaction/using-simulation-ui',
  brand:
    'https://www.figma.com/design/qtIdrKNMgyeq8e3yQrSzCq/Hyperlane-Brand-Assets?node-id=0-1&t=cYnVQdfLxqq0ekOW-1',
  imgPath: registryImgPath(),
};

export const docLinks = {
  home: 'https://docs.hyperlane.xyz/',
  chains: 'https://docs.hyperlane.xyz/docs/reference/domains',
  pi: 'https://docs.hyperlane.xyz/docs/deploy-hyperlane',
  ism: 'https://docs.hyperlane.xyz/docs/reference/ISM/specify-your-ISM',
  gas: 'https://docs.hyperlane.xyz/docs/protocol/interchain-gas-payment',
  registry: 'https://docs.hyperlane.xyz/docs/reference/registries',
};
