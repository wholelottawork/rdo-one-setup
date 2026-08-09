// Aster deposit on EVM chains — the vault call the browser has to make.
//
// There is NO per-user Aster deposit address on an EVM chain. The address-based
// model this app used to assume came from a Binance-shaped endpoint
// (`/fapi/v1/capital/deposit/address`) that does not exist in Aster's API; the
// one documented `user-deposit-address` endpoint is SUI-only and spot-only.
//
// A deposit is a call to the chain's Aster vault:
//
//   function depositFor(address currency, address forAddress, uint256 amount, uint256 broker) payable
//
// Only the calldata lives here, so it can be pinned by a test
// (./asterDeposit.test.ts) — the provider plumbing (allowance, chain switch,
// receipt) stays in app/transfer/page.tsx next to the other transfer flows.

export const ASTER_VAULTS: Record<string, string> = {
  '1':     '0x604DD02d620633Ae427888d41bfd15e38483736E',
  '56':    '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974',
  '42161': '0x9E36CB86a159d479cEd94Fa05036f235Ac40E1d5',
};

// Every deposit path in this app converts to USDT on Arbitrum first.
export const ASTER_DEPOSIT_CHAIN = '42161';

// keccak256('depositFor(address,address,uint256,uint256)')[0..4]
export const DEPOSIT_FOR_SELECTOR = '0xcf4a0c5e';

// THE ONE VALUE THAT SILENTLY MISROUTES FUNDS.
//
// broker === 1000 credits the SPOT account; ANY other value credits FUTURES.
// This app trades perps, and nothing in it can see a spot balance — a deposit
// sent with 1000 is simply gone as far as the user is concerned, with no error
// anywhere. Aster's own sample passes 0, so this does too.
export const ASTER_BROKER = BigInt(0);
export const ASTER_SPOT_BROKER = BigInt(1000);

// `currency` placeholder for a native-token deposit: the vault reads the amount
// from msg.value instead of pulling it with transferFrom.
export const ASTER_NATIVE_CURRENCY = '0xfdAE1bA7C826aBDc4c99903c8056f82a1A04a615';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export function asterVault(chainId: string): string {
  const vault = ASTER_VAULTS[chainId];
  if (!vault) throw new Error(`Aster has no deposit vault on chain ${chainId}`);
  return vault;
}

export function isNativeCurrency(token: string): boolean {
  return !token || token.toLowerCase() === ZERO_ADDRESS;
}

const padAddr = (v: string) => v.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const padUint = (v: bigint) => v.toString(16).padStart(64, '0');

/**
 * Hand-rolled `depositFor` calldata, matching the encoding style of the other
 * transfer helpers (`'0x' + selector + padded args`) rather than pulling in an
 * ABI coder for one static signature.
 *
 * `token` is the ERC-20 to deposit, or the zero address / '' for the chain's
 * native token — which becomes the ASTER_NATIVE_CURRENCY placeholder, with the
 * amount sent as msg.value by the caller.
 *
 * `forAddress` is the account credited. It is passed explicitly rather than
 * inferred from msg.sender, and is what makes this the only deposit path that
 * can name the futures account.
 */
export function encodeDepositFor(opts: {
  token: string;
  forAddress: string;
  amount: string | bigint;
  broker?: bigint;
}): string {
  const { token, forAddress, amount, broker = ASTER_BROKER } = opts;
  const currency = isNativeCurrency(token) ? ASTER_NATIVE_CURRENCY : token;
  return DEPOSIT_FOR_SELECTOR
    + padAddr(currency)
    + padAddr(forAddress)
    + padUint(BigInt(amount))
    + padUint(broker);
}
