#!/bin/sh
# Einmalig auf der Oracle-VM (Ubuntu) ausfuehren: Docker installieren, Ports 80/443 oeffnen.
set -e
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
# Ubuntu-Images von Oracle blockieren Ports per iptables, zusaetzlich zur Security List in der Cloud-Konsole.
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || sudo sh -c 'iptables-save > /etc/iptables/rules.v4'
echo "Fertig. Neu anmelden (exit, wieder ssh), dann: cd korrektur/oracle && cp .env.example .env && nano .env && docker compose up -d --build"
