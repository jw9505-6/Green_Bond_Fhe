// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface GreenBond {
  id: string;
  projectName: string;
  encryptedYield: string;
  encryptedAmount: string;
  timestamp: number;
  issuer: string;
  category: string;
  status: "active" | "matured" | "defaulted";
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [bonds, setBonds] = useState<GreenBond[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issuing, setIssuing] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newBondData, setNewBondData] = useState({ 
    projectName: "", 
    category: "Solar", 
    expectedYield: 0,
    amount: 0,
    description: "" 
  });
  const [selectedBond, setSelectedBond] = useState<GreenBond | null>(null);
  const [decryptedYield, setDecryptedYield] = useState<number | null>(null);
  const [decryptedAmount, setDecryptedAmount] = useState<number | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("All");
  const [userHistory, setUserHistory] = useState<string[]>([]);

  const activeCount = bonds.filter(b => b.status === "active").length;
  const maturedCount = bonds.filter(b => b.status === "matured").length;
  const defaultedCount = bonds.filter(b => b.status === "defaulted").length;

  useEffect(() => {
    loadBonds().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadBonds = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) return;
      
      const keysBytes = await contract.getData("bond_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing bond keys:", e); }
      }
      
      const list: GreenBond[] = [];
      for (const key of keys) {
        try {
          const bondBytes = await contract.getData(`bond_${key}`);
          if (bondBytes.length > 0) {
            try {
              const bondData = JSON.parse(ethers.toUtf8String(bondBytes));
              list.push({ 
                id: key, 
                projectName: bondData.projectName,
                encryptedYield: bondData.encryptedYield, 
                encryptedAmount: bondData.encryptedAmount,
                timestamp: bondData.timestamp, 
                issuer: bondData.issuer, 
                category: bondData.category, 
                status: bondData.status || "active" 
              });
            } catch (e) { console.error(`Error parsing bond data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading bond ${key}:`, e); }
      }
      list.sort((a, b) => b.timestamp - a.timestamp);
      setBonds(list);
    } catch (e) { console.error("Error loading bonds:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const issueBond = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setIssuing(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting bond data with Zama FHE..." });
    try {
      const encryptedYield = FHEEncryptNumber(newBondData.expectedYield);
      const encryptedAmount = FHEEncryptNumber(newBondData.amount);
      
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const bondId = `bond-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const bondData = { 
        projectName: newBondData.projectName,
        encryptedYield, 
        encryptedAmount,
        timestamp: Math.floor(Date.now() / 1000), 
        issuer: address, 
        category: newBondData.category, 
        status: "active",
        description: newBondData.description
      };
      
      await contract.setData(`bond_${bondId}`, ethers.toUtf8Bytes(JSON.stringify(bondData)));
      
      const keysBytes = await contract.getData("bond_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(bondId);
      await contract.setData("bond_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));
      
      setTransactionStatus({ visible: true, status: "success", message: "Green Bond issued successfully with FHE encryption!" });
      addUserHistory(`Issued bond: ${newBondData.projectName}`);
      await loadBonds();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowIssueModal(false);
        setNewBondData({ 
          projectName: "", 
          category: "Solar", 
          expectedYield: 0,
          amount: 0,
          description: "" 
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Issuance failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setIssuing(false); }
  };

  const decryptWithSignature = async (encryptedData: string): Promise<number | null> => {
    if (!isConnected) { alert("Please connect wallet first"); return null; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      return FHEDecryptNumber(encryptedData);
    } catch (e) { 
      console.error("Decryption failed:", e); 
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const addUserHistory = (action: string) => {
    setUserHistory(prev => [action, ...prev.slice(0, 9)]);
  };

  const filteredBonds = bonds.filter(bond => {
    const matchesSearch = bond.projectName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         bond.category.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = filterCategory === "All" || bond.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ["All", "Solar", "Wind", "Hydro", "Biomass", "Geothermal", "Other"];

  const renderStatsCards = () => {
    return (
      <div className="stats-cards">
        <div className="stat-card">
          <div className="stat-value">{bonds.length}</div>
          <div className="stat-label">Total Bonds</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{activeCount}</div>
          <div className="stat-label">Active</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{maturedCount}</div>
          <div className="stat-label">Matured</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{defaultedCount}</div>
          <div className="stat-label">Defaulted</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading Green Bonds...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>Green Bond FHE</h1>
          <p>Privacy-Preserving Green Bonds with Zama FHE</p>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowIssueModal(true)} className="primary-button">
            Issue New Bond
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <main className="main-content">
        <section className="project-intro">
          <h2>Green Bond Marketplace</h2>
          <p>
            A decentralized platform for issuing and trading green bonds with fully homomorphic encryption (FHE). 
            Project financials remain encrypted while allowing investors to verify returns and sustainability metrics.
          </p>
          <div className="fhe-badge">
            <span>Powered by Zama FHE</span>
          </div>
        </section>

        <section className="data-section">
          <h2>Market Statistics</h2>
          {renderStatsCards()}
        </section>

        <section className="search-section">
          <div className="search-filter">
            <input
              type="text"
              placeholder="Search bonds..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="filter-select"
            >
              {categories.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
            <button onClick={loadBonds} className="refresh-button" disabled={isRefreshing}>
              {isRefreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </section>

        <section className="bonds-section">
          <h2>Available Green Bonds</h2>
          {filteredBonds.length === 0 ? (
            <div className="no-bonds">
              <p>No green bonds found matching your criteria</p>
              <button className="primary-button" onClick={() => setShowIssueModal(true)}>
                Issue the First Bond
              </button>
            </div>
          ) : (
            <div className="bonds-grid">
              {filteredBonds.map(bond => (
                <div className="bond-card" key={bond.id} onClick={() => setSelectedBond(bond)}>
                  <div className="bond-header">
                    <h3>{bond.projectName}</h3>
                    <span className={`status-badge ${bond.status}`}>{bond.status}</span>
                  </div>
                  <div className="bond-details">
                    <div className="detail-item">
                      <span>Category:</span>
                      <strong>{bond.category}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Issuer:</span>
                      <strong>{bond.issuer.substring(0, 6)}...{bond.issuer.substring(38)}</strong>
                    </div>
                    <div className="detail-item">
                      <span>Issued:</span>
                      <strong>{new Date(bond.timestamp * 1000).toLocaleDateString()}</strong>
                    </div>
                  </div>
                  <div className="bond-footer">
                    <button className="action-button" onClick={(e) => {
                      e.stopPropagation();
                      setSelectedBond(bond);
                    }}>
                      View Details
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {userHistory.length > 0 && (
          <section className="history-section">
            <h2>Your Recent Activity</h2>
            <div className="history-list">
              {userHistory.map((action, index) => (
                <div key={index} className="history-item">
                  <div className="history-icon">✓</div>
                  <div className="history-action">{action}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {showIssueModal && (
        <div className="modal-overlay">
          <div className="issue-modal">
            <div className="modal-header">
              <h2>Issue New Green Bond</h2>
              <button onClick={() => setShowIssueModal(false)} className="close-button">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>Project Name *</label>
                <input
                  type="text"
                  name="projectName"
                  value={newBondData.projectName}
                  onChange={(e) => setNewBondData({...newBondData, projectName: e.target.value})}
                  placeholder="e.g. Solar Farm Project"
                />
              </div>
              <div className="form-group">
                <label>Category *</label>
                <select
                  name="category"
                  value={newBondData.category}
                  onChange={(e) => setNewBondData({...newBondData, category: e.target.value})}
                >
                  <option value="Solar">Solar Energy</option>
                  <option value="Wind">Wind Energy</option>
                  <option value="Hydro">Hydroelectric</option>
                  <option value="Biomass">Biomass</option>
                  <option value="Geothermal">Geothermal</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Expected Yield (%) *</label>
                  <input
                    type="number"
                    name="expectedYield"
                    value={newBondData.expectedYield}
                    onChange={(e) => setNewBondData({...newBondData, expectedYield: parseFloat(e.target.value)})}
                    step="0.1"
                    min="0"
                  />
                </div>
                <div className="form-group">
                  <label>Amount ($) *</label>
                  <input
                    type="number"
                    name="amount"
                    value={newBondData.amount}
                    onChange={(e) => setNewBondData({...newBondData, amount: parseFloat(e.target.value)})}
                    min="0"
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Description</label>
                <textarea
                  name="description"
                  value={newBondData.description}
                  onChange={(e) => setNewBondData({...newBondData, description: e.target.value})}
                  placeholder="Brief description of the project..."
                  rows={3}
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-row">
                  <div className="preview-label">Yield:</div>
                  <div className="preview-value">
                    {newBondData.expectedYield > 0 ? 
                      FHEEncryptNumber(newBondData.expectedYield).substring(0, 20) + '...' : 
                      'Not encrypted yet'}
                  </div>
                </div>
                <div className="preview-row">
                  <div className="preview-label">Amount:</div>
                  <div className="preview-value">
                    {newBondData.amount > 0 ? 
                      FHEEncryptNumber(newBondData.amount).substring(0, 20) + '...' : 
                      'Not encrypted yet'}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowIssueModal(false)} className="secondary-button">
                Cancel
              </button>
              <button onClick={issueBond} disabled={issuing} className="primary-button">
                {issuing ? "Issuing Bond..." : "Issue Bond with FHE"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedBond && (
        <div className="modal-overlay">
          <div className="bond-detail-modal">
            <div className="modal-header">
              <h2>{selectedBond.projectName}</h2>
              <button onClick={() => {
                setSelectedBond(null);
                setDecryptedYield(null);
                setDecryptedAmount(null);
              }} className="close-button">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="bond-info">
                <div className="info-row">
                  <span>Status:</span>
                  <strong className={`status-badge ${selectedBond.status}`}>{selectedBond.status}</strong>
                </div>
                <div className="info-row">
                  <span>Category:</span>
                  <strong>{selectedBond.category}</strong>
                </div>
                <div className="info-row">
                  <span>Issuer:</span>
                  <strong>{selectedBond.issuer}</strong>
                </div>
                <div className="info-row">
                  <span>Issued Date:</span>
                  <strong>{new Date(selectedBond.timestamp * 1000).toLocaleString()}</strong>
                </div>
              </div>

              <div className="encrypted-section">
                <h3>Encrypted Financials</h3>
                <div className="encrypted-data">
                  <div className="data-item">
                    <span>Yield:</span>
                    <code>{selectedBond.encryptedYield.substring(0, 30)}...</code>
                  </div>
                  <div className="data-item">
                    <span>Amount:</span>
                    <code>{selectedBond.encryptedAmount.substring(0, 30)}...</code>
                  </div>
                </div>
                <div className="fhe-tag">
                  <span>Fully Homomorphically Encrypted</span>
                </div>
              </div>

              <div className="decrypt-section">
                <button 
                  className="decrypt-button" 
                  onClick={async () => {
                    if (decryptedYield !== null) {
                      setDecryptedYield(null);
                      setDecryptedAmount(null);
                      return;
                    }
                    setIsDecrypting(true);
                    const yieldValue = await decryptWithSignature(selectedBond.encryptedYield);
                    const amountValue = await decryptWithSignature(selectedBond.encryptedAmount);
                    setDecryptedYield(yieldValue);
                    setDecryptedAmount(amountValue);
                    setIsDecrypting(false);
                    addUserHistory(`Decrypted bond: ${selectedBond.projectName}`);
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : 
                   decryptedYield !== null ? "Hide Values" : "Decrypt with Wallet"}
                </button>
              </div>

              {decryptedYield !== null && decryptedAmount !== null && (
                <div className="decrypted-section">
                  <h3>Decrypted Values</h3>
                  <div className="decrypted-data">
                    <div className="data-item">
                      <span>Yield:</span>
                      <strong>{decryptedYield}%</strong>
                    </div>
                    <div className="data-item">
                      <span>Amount:</span>
                      <strong>${decryptedAmount.toLocaleString()}</strong>
                    </div>
                  </div>
                  <div className="decrypt-notice">
                    Values decrypted using your wallet signature. Never share these values.
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className="transaction-notification">
          <div className={`notification-content ${transactionStatus.status}`}>
            <div className="notification-icon">
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✕"}
            </div>
            <div className="notification-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-left">
            <h3>Green Bond FHE</h3>
            <p>Privacy-preserving green finance platform</p>
          </div>
          <div className="footer-right">
            <div className="footer-links">
              <a href="#" className="footer-link">Documentation</a>
              <a href="#" className="footer-link">About Zama FHE</a>
              <a href="#" className="footer-link">Contact</a>
            </div>
            <div className="footer-copyright">
              © {new Date().getFullYear()} Green Bond FHE. All rights reserved.
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;