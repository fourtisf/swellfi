"use client";

import { Empty, Icon, type IconName } from "@tideline/ui";
import { useState } from "react";
import { useSession } from "@/lib/session";
import { toast } from "@/lib/ui-store";

type Tab = "pos" | "open" | "twap" | "hist" | "fund";
const TABS: [Tab, string][] = [
  ["pos", "Positions"],
  ["open", "Open Orders"],
  ["twap", "TWAP"],
  ["hist", "Order History"],
  ["fund", "Funding History"],
];

const EMPTY: Record<Tab, [IconName, string, string]> = {
  pos: ["bolt", "No open positions", "Place an order on the right and your position shows up here."],
  open: ["trade", "No open orders", "Limit and stop orders wait here until the price reaches them."],
  twap: ["chart", "TWAP orders", "Split a large order into small slices over a set time to reduce price impact. Coming in a later release."],
  hist: ["doc", "No orders yet", "Every filled and cancelled order is listed here."],
  fund: ["chart", "No funding yet", "Open positions pay or receive funding every hour."],
};

/** Positions / orders / history tabs. Real Hyperliquid data is wired in Phase 2. */
export function BottomTabs() {
  const s = useSession();
  const [tab, setTab] = useState<Tab>("pos");
  const [anaOpen, setAnaOpen] = useState(true);
  const [icon, title, desc] = EMPTY[tab];
  const signedOut = s.status !== "ready" && tab !== "twap";
  return (
    <div className="tbottom">
      <div className="btabs">
        <div className="seg">
          {TABS.map(([k, label]) => (
            <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
        <button className="tool" title="Table settings" onClick={() => toast("Table settings arrive with live positions")}>
          <Icon name="gear" size={16} />
        </button>
        <span className="spacer" />
        <span className="mut" />
      </div>
      <div className="scroll-x" id="posBody">
        {signedOut ? (
          <Empty icon={<Icon name="wallet" size={20} />} title="Sign in to see your account" style={{ padding: "26px 16px" }}>
            Positions, orders and history show here once you connect.
          </Empty>
        ) : (
          <Empty icon={<Icon name={icon} size={20} />} title={title} style={{ padding: "26px 16px" }}>
            {desc}
          </Empty>
        )}
      </div>
      <button className={`anah${anaOpen ? "" : " closed"}`} onClick={() => setAnaOpen((o) => !o)}>
        <span className="car">▾</span>
        <Icon name="chart" size={14} /> ANALYTICS
      </button>
      {anaOpen && (
        <div className="ana">
          {["Realized PnL", "Win rate", "Closed trades", "Best trade", "Volume", "Fees paid"].map((k) => (
            <div key={k}>
              <small>{k}</small>
              <b>—</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
