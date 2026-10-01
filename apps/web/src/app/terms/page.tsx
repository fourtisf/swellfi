import { BRAND } from "@/lib/env";

export const metadata = { title: "Terms & risk disclosure" };

// Placeholder copy: final Terms of Service and risk disclosure come from ALFA's lawyer.
export default function TermsPage() {
  return (
    <section className="view on">
      <div className="profile" style={{ paddingTop: 24 }}>
        <div className="page-head">
          <div>
            <h2>Terms &amp; risk disclosure</h2>
            <p>Draft. The final Terms of Service will replace this page before public launch.</p>
          </div>
        </div>
        <div className="glass" style={{ padding: 24, lineHeight: 1.65 }}>
          <h3 style={{ marginTop: 0 }}>Non-custodial</h3>
          <p className="mut">
            {BRAND} never holds your funds. Your USDC sits in your own Hyperliquid account. Orders are signed by a trading key that you
            approve; it can place and cancel orders but cannot withdraw. Withdrawals are always signed by your own wallet.
          </p>
          <h3>Leverage and liquidation</h3>
          <p className="mut">
            Perpetual futures use leverage. A small price move against you can liquidate your position and you can lose your entire
            margin. Liquidation prices shown in the app are estimates; Hyperliquid determines the actual liquidation.
          </p>
          <h3>Past performance</h3>
          <p className="mut">
            Rankings, profiles, feed posts and fund returns show historical results. Past performance of any trader or fund does not
            predict future results. Nothing on {BRAND} is investment advice.
          </p>
          <h3>Fees</h3>
          <p className="mut">
            Every order pays Hyperliquid&apos;s exchange fee plus a {BRAND} builder fee, shown in the order panel before you trade.
          </p>
          <h3>Eligibility</h3>
          <p className="mut">
            {BRAND} is not available to residents of the United States or sanctioned jurisdictions. You are responsible for complying
            with the laws where you live.
          </p>
        </div>
      </div>
    </section>
  );
}
