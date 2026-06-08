# Celo Arb Agent — VPS Deployment

## Quick setup on your VPS

```bash
# 1. SSH into your VPS
ssh root@YOUR_VPS_IP

# 2. Install deps
apt update && apt install -y python3-pip git
pip3 install web3 requests

# 3. Create agent directory
mkdir -p /opt/celo-arb-agent
cd /opt/celo-arb-agent
```

## Deploy the agent

```bash
# 4. Download the agent
curl -O https://raw.githubusercontent.com/latest63/celo-arb-scanner/master/scripts/arb_agent.py
chmod +x arb_agent.py

# 5. Create config
cat > .env << 'EOF'
ARB_ROUTER=0x_DEPLOYED_CONTRACT_ADDRESS
AGENT_PRIVATE_KEY=0x_YOUR_PRIVATE_KEY
MIN_SPREAD=0.05
SLIPPAGE=0.3
CELO_RPC=https://forno.celo.org
EOF

# 6. Test run (one cycle)
python3 arb_agent.py
```

## Run as a service (always on)

```bash
# 7. Install systemd service
cat > /etc/systemd/system/celo-arb-agent.service << 'SERVICEOF'
[Unit]
Description=Celo Arbitrage Agent
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/celo-arb-agent
EnvironmentFile=/opt/celo-arb-agent/.env
Environment=AGENT_MODE=loop
Environment=AGENT_INTERVAL=20
ExecStart=/usr/bin/python3 /opt/celo-arb-agent/arb_agent.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICEOF

systemctl daemon-reload
systemctl enable celo-arb-agent
systemctl start celo-arb-agent

# 8. Check status
systemctl status celo-arb-agent
journalctl -u celo-arb-agent -f
```

## Deploy the contract (one-time, needs CELO for gas)

```bash
# On your local machine with Foundry:
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
echo 'PRIVATE_KEY=0x_YOUR_KEY' > .env
source .env && forge script script/Deploy.s.sol \
  --rpc-url celo --private-key $PRIVATE_KEY --broadcast
```

## Fund the contract

1. Get the deployed address from the deployment output
2. Send USDC to that address from your wallet
3. The agent will use this capital to trade

## Monitor

- **Logs**: `journalctl -u celo-arb-agent -f`
- **Dashboard**: celo-arb-scanner.vercel.app
- **Agent stats**: `/opt/celo-arb-agent/agent_stats.json`
