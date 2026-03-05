import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Bell, Camera, Mic, MapPin, Shield, Users, Settings, History, Activity, Play, FileAudio, Image as ImageIcon, CheckCircle2, Download, Trash2, Video, X, AlertTriangle, MessageSquare, Send, Sparkles, Loader2 } from 'lucide-react';
import { AppConfig, EmergencyContact, Evidence } from '../types';
import { GoogleGenAI } from "@google/genai";

interface SOSDashboardProps {
  config: AppConfig;
  evidence: Evidence[];
  onUpdateConfig: (newConfig: AppConfig) => void;
  onDeleteEvidence: (id: string, url: string) => void;
  onDeleteAllEvidence: () => void;
  onClose: () => void;
}

function EvidenceItem({ item, onDelete, onPlayVideo }: { item: Evidence, onDelete: (id: string, url: string) => void, onPlayVideo: (url: string) => void, key?: string }) {
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <div className="bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 group">
      <div className="aspect-square bg-zinc-800 relative">
        {item.type === 'photo' ? (
          <img 
            src={item.url} 
            alt="Evidence" 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.src = 'https://picsum.photos/seed/error/800/800';
            }}
          />
        ) : item.type === 'video' ? (
          <video 
            src={`${item.url}#t=0.1`} 
            className="w-full h-full object-cover"
            muted
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-orange-500">
            <FileAudio size={40} />
          </div>
        )}
        <div className={`absolute inset-0 bg-black/40 transition-opacity flex items-center justify-center gap-3 ${isConfirming ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
          {!isConfirming ? (
            <>
              <button 
                onClick={() => {
                  if (item.type === 'audio') {
                    const audio = new Audio(item.url);
                    audio.play().catch(err => {
                      console.error("Playback failed:", err);
                    });
                  } else if (item.type === 'video') {
                    onPlayVideo(item.url);
                  } else {
                    window.open(item.url, '_blank');
                  }
                }}
                title={item.type === 'photo' ? "View Photo" : item.type === 'video' ? "Play Video" : "Play Audio"}
                className="w-10 h-10 bg-white text-black rounded-full flex items-center justify-center hover:scale-110 transition-transform"
              >
                {item.type === 'photo' ? <ImageIcon size={20} /> : item.type === 'video' ? <Video size={20} /> : <Play size={20} className="ml-1" />}
              </button>
              
              <a 
                href={`${item.url}?download=true`} 
                download={`evidence_${item.id}.${item.type === 'photo' ? 'jpg' : 'webm'}`}
                title="Download"
                className="w-10 h-10 bg-zinc-800 text-white rounded-full flex items-center justify-center hover:scale-110 transition-transform"
              >
                <Download size={20} />
              </a>

              <button 
                onClick={() => setIsConfirming(true)}
                title="Delete Evidence"
                className="w-10 h-10 bg-red-600/20 text-red-500 rounded-full flex items-center justify-center hover:bg-red-600 hover:text-white hover:scale-110 transition-all"
              >
                <Trash2 size={20} />
              </button>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <span className="text-[10px] font-bold text-white uppercase tracking-wider">Are you sure?</span>
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    onDelete(item.id, item.url);
                    setIsConfirming(false);
                  }}
                  className="px-3 py-1 bg-red-600 text-white text-[10px] font-bold rounded-lg uppercase tracking-wider"
                >
                  Delete
                </button>
                <button 
                  onClick={() => setIsConfirming(false)}
                  className="px-3 py-1 bg-zinc-800 text-white text-[10px] font-bold rounded-lg uppercase tracking-wider"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="p-3">
        <div className="flex justify-between items-start">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {item.type === 'photo' ? 'Photo Capture' : item.type === 'video' ? 'Video Recording' : 'Audio Recording'}
          </p>
          <div className="flex items-center gap-1 text-[8px] text-emerald-500 font-bold uppercase tracking-tighter">
            <CheckCircle2 size={8} />
            <span>Synced</span>
          </div>
        </div>
        <p className="text-[10px] text-zinc-600">
          {new Date(item.timestamp).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

export default function SOSDashboard({ config, evidence, onUpdateConfig, onDeleteEvidence, onDeleteAllEvidence, onClose, onTestAlarm }: SOSDashboardProps & { onTestAlarm: () => void }) {
  const [activeTab, setActiveTab] = useState<'status' | 'contacts' | 'triggers' | 'evidence' | 'settings' | 'ai'>('status');
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [playingVideo, setPlayingVideo] = useState<string | null>(null);
  const [showSaved, setShowSaved] = useState(false);
  
  // AI Chat State
  const [aiMessages, setAiMessages] = useState<{ role: 'user' | 'ai', text: string }[]>([
    { role: 'ai', text: "Hello! I'm your StealthSOS AI assistant. I can help you configure your safety settings, explain how the app works, or provide advice on personal safety. How can I help you today?" }
  ]);
  const [aiInput, setAiInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [aiMessages]);

  const handleAiChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInput.trim() || isAiLoading) return;

    const userText = aiInput;
    setAiInput('');
    setAiMessages(prev => [...prev, { role: 'user', text: userText }]);
    setIsAiLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Prepare context about the app and current evidence
      const evidenceContext = evidence.map(e => `- ${e.type} captured at ${new Date(e.timestamp).toLocaleString()}`).join('\n');
      const systemInstruction = `You are a helpful and discreet personal safety assistant for the StealthSOS app. 
      The user is currently in the Admin Panel (Evidence Vault).
      App Features:
      - Silent SOS (911#)
      - Voice Detection (Custom keywords)
      - Motion Detection (Falls/Running)
      - Tents (Safe Circles with Voice Calls)
      - Evidence Vault (Photos/Audio/Video)
      - Guardian View (Remote monitoring)
      
      Current Evidence in Vault:
      ${evidenceContext || 'No evidence captured yet.'}
      
      Be concise, professional, and prioritize user safety. If they ask about their evidence, refer to the list provided.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [...aiMessages.map(m => ({ role: m.role === 'ai' ? 'model' : 'user', parts: [{ text: m.text }] })), { role: 'user', parts: [{ text: userText }] }],
        config: {
          systemInstruction,
        }
      });

      const aiText = response.text || "I'm sorry, I couldn't process that request.";
      setAiMessages(prev => [...prev, { role: 'ai', text: aiText }]);
    } catch (error) {
      console.error("AI Chat Error:", error);
      setAiMessages(prev => [...prev, { role: 'ai', text: "I'm having trouble connecting to my brain right now. Please check your internet connection and try again." }]);
    } finally {
      setIsAiLoading(false);
    }
  };
  
  // Contact Form State
  const [isAddingContact, setIsAddingContact] = useState(false);
  const [newContact, setNewContact] = useState<EmergencyContact>({ name: '', phone: '', priority: 1 });
  const [contactError, setContactError] = useState<string | null>(null);

  const handleSaveKeyword = () => {
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  const handleAddContact = () => {
    if (!newContact.name || !newContact.phone) {
      setContactError('Name and phone are required');
      return;
    }
    
    const updatedContacts = [...config.emergencyContacts, newContact];
    onUpdateConfig({ ...config, emergencyContacts: updatedContacts });
    setNewContact({ name: '', phone: '', priority: config.emergencyContacts.length + 2 });
    setIsAddingContact(false);
    setContactError(null);
  };

  const handleRemoveContact = (idx: number) => {
    const updatedContacts = config.emergencyContacts.filter((_, i) => i !== idx);
    onUpdateConfig({ ...config, emergencyContacts: updatedContacts });
  };

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white z-50 flex flex-col">
      <AnimatePresence>
        {playingVideo && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/90 z-[100] flex items-center justify-center p-4"
          >
            <button 
              onClick={() => setPlayingVideo(null)}
              className="absolute top-6 right-6 w-12 h-12 bg-zinc-800 text-white rounded-full flex items-center justify-center hover:bg-zinc-700 transition-colors z-[101]"
            >
              <X size={24} />
            </button>
            <video 
              src={playingVideo} 
              controls 
              autoPlay 
              className="max-w-full max-h-full rounded-xl"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <header className="p-4 md:p-6 border-b border-zinc-800 flex justify-between items-center">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-orange-600 rounded-xl flex items-center justify-center">
            <Shield size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">StealthSOS</h1>
            <p className="text-xs text-zinc-500 uppercase tracking-widest">Security Dashboard</p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="px-4 py-2 bg-zinc-800 rounded-lg text-sm font-medium hover:bg-zinc-700 transition-colors"
        >
          Exit Stealth Mode
        </button>
      </header>

      <nav className="flex border-b border-zinc-800">
        {[
          { id: 'status', label: 'Status', icon: Activity },
          { id: 'contacts', label: 'Contacts', icon: Users },
          { id: 'triggers', label: 'Triggers', icon: Bell },
          { id: 'evidence', label: 'Evidence', icon: Camera },
          { id: 'ai', label: 'AI Assistant', icon: Sparkles },
          { id: 'settings', label: 'Settings', icon: Settings },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex-1 py-4 flex flex-col items-center gap-1 transition-colors ${
              activeTab === tab.id ? 'text-orange-500 bg-orange-500/5' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <tab.icon size={20} />
            <span className="text-[10px] uppercase font-bold tracking-wider">{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto p-6">
        {activeTab === 'status' && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <StatusCard icon={Mic} label="Audio Detection" active={config.aiDetection.voice} />
              <StatusCard icon={Activity} label="Motion Analysis" active={config.aiDetection.motion} />
              <StatusCard icon={Camera} label="Auto Evidence" active={config.evidence.camera} />
              <StatusCard icon={MapPin} label="Live Tracking" active={true} />
            </div>

            {!window.isSecureContext && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 flex items-start gap-3">
                <AlertTriangle className="text-red-500 shrink-0 mt-0.5" size={18} />
                <div className="space-y-1">
                  <p className="text-sm font-bold text-red-500 uppercase tracking-wider">Insecure Context Detected</p>
                  <p className="text-xs text-red-500/80 leading-relaxed">
                    Browser security requires <strong>HTTPS</strong> for voice detection. Please ensure you are accessing the app via the secure URL: 
                    <br />
                    <code className="bg-black/30 px-1 rounded select-all break-all">{window.location.href.replace('http://', 'https://')}</code>
                  </p>
                </div>
              </div>
            )}

            <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-4">System Actions</h3>
              <button 
                onClick={onTestAlarm}
                className="w-full py-3 bg-red-500/10 text-red-500 border border-red-500/20 rounded-xl font-bold uppercase tracking-wider hover:bg-red-500 hover:text-white transition-colors flex items-center justify-center gap-2"
              >
                <Bell size={18} />
                Test Emergency Alarm
              </button>
              <p className="text-[10px] text-zinc-500 mt-2 text-center">
                This will trigger the siren on THIS device only. Use to verify audio permissions.
              </p>
            </div>

            <div className="bg-zinc-900 rounded-2xl p-6 border border-zinc-800">
              <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-500 mb-4">Recent Activity</h3>
              <div className="space-y-4">
                <ActivityItem time="2h ago" label="System check completed" status="success" />
                <ActivityItem time="5h ago" label="Location updated" status="info" />
                <ActivityItem time="Yesterday" label="Fake mode activated" status="info" />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'contacts' && (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Emergency Contacts</h3>
              <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                {config.emergencyContacts.length} / 5 Contacts
              </p>
            </div>

            <div className="space-y-3">
              {config.emergencyContacts.map((contact, idx) => (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  key={idx} 
                  className="bg-zinc-900 p-4 rounded-xl border border-zinc-800 flex justify-between items-center group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400 font-bold text-xs">
                      {contact.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-medium text-sm">{contact.name}</p>
                      <p className="text-xs text-zinc-500">{contact.phone}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="px-2 py-0.5 bg-orange-500/10 text-orange-500 rounded-full text-[10px] font-bold uppercase tracking-wider">
                      P{contact.priority}
                    </div>
                    <button 
                      onClick={() => handleRemoveContact(idx)}
                      className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>

            <AnimatePresence>
              {isAddingContact ? (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-zinc-900 rounded-xl border border-orange-500/30 overflow-hidden"
                >
                  <div className="p-4 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Name</label>
                        <input 
                          type="text"
                          value={newContact.name}
                          onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                          placeholder="Contact Name"
                          className="w-full bg-black border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-orange-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Phone</label>
                        <input 
                          type="tel"
                          value={newContact.phone}
                          onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                          placeholder="+1234567890"
                          className="w-full bg-black border border-zinc-800 rounded-lg p-2 text-sm focus:outline-none focus:border-orange-500"
                        />
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Priority</label>
                        <select 
                          value={newContact.priority}
                          onChange={(e) => setNewContact({ ...newContact, priority: parseInt(e.target.value) })}
                          className="bg-black border border-zinc-800 rounded-lg px-2 py-1 text-xs"
                        >
                          {[1, 2, 3, 4, 5].map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setIsAddingContact(false)}
                          className="px-3 py-1.5 text-xs font-bold text-zinc-500 hover:text-white transition-colors uppercase tracking-wider"
                        >
                          Cancel
                        </button>
                        <button 
                          onClick={handleAddContact}
                          className="px-4 py-1.5 bg-orange-600 text-white text-xs font-bold rounded-lg hover:bg-orange-500 transition-colors uppercase tracking-wider"
                        >
                          Add Contact
                        </button>
                      </div>
                    </div>
                    {contactError && <p className="text-[10px] text-red-500 font-bold">{contactError}</p>}
                  </div>
                </motion.div>
              ) : (
                config.emergencyContacts.length < 5 && (
                  <button 
                    onClick={() => setIsAddingContact(true)}
                    className="w-full py-4 border-2 border-dashed border-zinc-800 rounded-xl text-zinc-500 font-medium hover:border-zinc-600 hover:text-zinc-300 transition-all flex items-center justify-center gap-2"
                  >
                    <Users size={18} />
                    <span>+ Add Contact</span>
                  </button>
                )
              )}
            </AnimatePresence>
            
            <div className="p-4 bg-zinc-900/50 rounded-xl border border-zinc-800/50">
              <p className="text-[10px] text-zinc-500 leading-relaxed">
                <Shield size={12} className="inline mr-1 mb-0.5 text-orange-500" />
                These contacts will be notified via SMS and automated call when SOS is triggered. They will receive your live location and evidence links.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'triggers' && (
          <div className="space-y-4">
            <TriggerToggle 
              label="Calculator Code" 
              description="Trigger SOS by entering 911# in the calculator"
              active={true}
              disabled={true}
            />
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <TriggerToggle 
                label="Voice Detection" 
                description="Triggers SOS only when danger keywords or your custom keyword are detected."
                active={config.aiDetection.voice}
                onChange={(v) => onUpdateConfig({ ...config, aiDetection: { ...config.aiDetection, voice: v } })}
                className="border-none"
              />
              {config.aiDetection.voice && (
                <div className="p-4 pt-0 border-t border-zinc-800/50 mt-2">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-2 block">Custom Voice Keyword</label>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={config.aiDetection.customVoiceKeyword || ''}
                      onChange={(e) => onUpdateConfig({ ...config, aiDetection: { ...config.aiDetection, customVoiceKeyword: e.target.value } })}
                      placeholder="e.g. help me"
                      className="flex-1 bg-black border border-zinc-800 rounded-lg p-3 text-white text-sm focus:outline-none focus:border-orange-500"
                    />
                    <button 
                      onClick={handleSaveKeyword}
                      className={`px-4 py-2 rounded-lg font-bold text-xs uppercase tracking-wider transition-colors ${
                        showSaved 
                          ? 'bg-emerald-600/20 text-emerald-500 border border-emerald-500/30' 
                          : 'bg-zinc-800 text-white hover:bg-zinc-700'
                      }`}
                    >
                      {showSaved ? 'Saved!' : 'Save'}
                    </button>
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-2">Saying this specific phrase will instantly trigger the SOS. (Auto-saves on type)</p>
                  <div className="mt-3 p-2 bg-orange-500/10 border border-orange-500/20 rounded-lg flex items-start gap-2">
                    <AlertTriangle size={14} className="text-orange-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-orange-500/90 leading-tight">
                      <strong>Note:</strong> Voice detection is paused while this dashboard is open. Exit to the calculator to test your keyword.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <TriggerToggle 
              label="Motion Detection" 
              description="Triggers on sudden falls or rapid running"
              active={config.aiDetection.motion}
              onChange={(v) => onUpdateConfig({ ...config, aiDetection: { ...config.aiDetection, motion: v } })}
            />
          </div>
        )}

        {activeTab === 'evidence' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bold">Evidence Vault</h3>
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{evidence.length} Items</span>
                {evidence.length > 0 && (
                  !isDeletingAll ? (
                    <button 
                      onClick={() => setIsDeletingAll(true)}
                      className="flex items-center gap-1 text-xs font-bold text-red-500 hover:text-red-400 uppercase tracking-wider transition-colors"
                    >
                      <Trash2 size={14} />
                      Delete All
                    </button>
                  ) : (
                    <div className="flex items-center gap-2 bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/20">
                      <span className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Sure?</span>
                      <button 
                        onClick={() => {
                          onDeleteAllEvidence();
                          setIsDeletingAll(false);
                        }}
                        className="text-[10px] font-bold text-white bg-red-600 px-2 py-0.5 rounded hover:bg-red-500 transition-colors uppercase tracking-wider"
                      >
                        Yes
                      </button>
                      <button 
                        onClick={() => setIsDeletingAll(false)}
                        className="text-[10px] font-bold text-zinc-400 hover:text-white transition-colors uppercase tracking-wider"
                      >
                        No
                      </button>
                    </div>
                  )
                )}
              </div>
            </div>

            {evidence.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
                <Shield size={48} className="mb-4 opacity-20" />
                <p className="text-sm font-medium">No evidence captured yet</p>
                <p className="text-xs">Evidence is automatically collected during SOS</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {evidence.map((item) => (
                  <EvidenceItem key={item.id} item={item} onDelete={onDeleteEvidence} onPlayVideo={setPlayingVideo} />
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">SOS Trigger Code</label>
              <input 
                type="text"
                value={config.fakeCalculatorCode}
                onChange={(e) => onUpdateConfig({ ...config, fakeCalculatorCode: e.target.value })}
                placeholder="e.g. 911#"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-white focus:outline-none focus:border-orange-500 font-mono"
              />
              <p className="text-[10px] text-zinc-500">Code entered in calculator to trigger SOS</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Admin Access Code</label>
              <input 
                type="text"
                value={config.adminCode}
                onChange={(e) => onUpdateConfig({ ...config, adminCode: e.target.value })}
                placeholder="e.g. 1234#"
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-white focus:outline-none focus:border-orange-500 font-mono"
              />
              <p className="text-[10px] text-zinc-500">Code entered in calculator to open this dashboard</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Dead Man Switch Timeout</label>
              <select 
                value={config.deadManTimeout}
                onChange={(e) => onUpdateConfig({ ...config, deadManTimeout: parseInt(e.target.value) })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-white focus:outline-none focus:border-orange-500"
              >
                <option value={3}>3 Seconds</option>
                <option value={5}>5 Seconds</option>
                <option value={10}>10 Seconds</option>
                <option value={30}>30 Seconds</option>
                <option value={60}>1 Minute</option>
                <option value={300}>5 Minutes</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-wider text-zinc-500">Evidence Collection</label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                  <input 
                    type="checkbox" 
                    checked={config.evidence.audio}
                    onChange={(e) => onUpdateConfig({ ...config, evidence: { ...config.evidence, audio: e.target.checked } })}
                    className="w-5 h-5 accent-orange-500"
                  />
                  <span>Record Audio</span>
                </label>
                <label className="flex items-center gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                  <input 
                    type="checkbox" 
                    checked={config.evidence.camera}
                    onChange={(e) => onUpdateConfig({ ...config, evidence: { ...config.evidence, camera: e.target.checked } })}
                    className="w-5 h-5 accent-orange-500"
                  />
                  <span>Capture Photos</span>
                </label>
                <label className="flex items-center gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                  <input 
                    type="checkbox" 
                    checked={config.evidence.video}
                    onChange={(e) => onUpdateConfig({ ...config, evidence: { ...config.evidence, video: e.target.checked } })}
                    className="w-5 h-5 accent-orange-500"
                  />
                  <span>Record Video</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto space-y-4 pb-4">
              {aiMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] p-4 rounded-2xl ${
                    msg.role === 'user' 
                      ? 'bg-orange-600 text-white rounded-tr-none' 
                      : 'bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-tl-none'
                  }`}>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                </div>
              ))}
              {isAiLoading && (
                <div className="flex justify-start">
                  <div className="bg-zinc-900 text-zinc-400 border border-zinc-800 p-4 rounded-2xl rounded-tl-none flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" />
                    <span className="text-xs font-bold uppercase tracking-wider">AI is thinking...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleAiChat} className="mt-auto pt-4 border-t border-zinc-800 flex gap-2">
              <input 
                type="text"
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                placeholder="Ask about safety or settings..."
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-sm focus:outline-none focus:border-orange-500"
              />
              <button 
                type="submit"
                disabled={isAiLoading || !aiInput.trim()}
                className="w-12 h-12 bg-orange-600 rounded-xl flex items-center justify-center hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={20} />
              </button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusCard({ icon: Icon, label, active }: { icon: any, label: string, active: boolean }) {
  return (
    <div className={`p-4 rounded-2xl border ${active ? 'bg-orange-500/10 border-orange-500/20' : 'bg-zinc-900 border-zinc-800'}`}>
      <Icon size={20} className={active ? 'text-orange-500' : 'text-zinc-500'} />
      <p className="mt-2 text-sm font-medium">{label}</p>
      <p className={`text-[10px] uppercase font-bold tracking-wider ${active ? 'text-orange-500' : 'text-zinc-600'}`}>
        {active ? 'Active' : 'Disabled'}
      </p>
    </div>
  );
}

function ActivityItem({ time, label, status }: { time: string, label: string, status: 'success' | 'info' | 'warning' }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-2 h-2 rounded-full mt-1.5 ${
        status === 'success' ? 'bg-emerald-500' : status === 'info' ? 'bg-blue-500' : 'bg-orange-500'
      }`} />
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{time}</p>
      </div>
    </div>
  );
}

function TriggerToggle({ label, description, active, onChange, disabled, className = '' }: { label: string, description: string, active: boolean, onChange?: (v: boolean) => void, disabled?: boolean, className?: string }) {
  return (
    <div className={`p-4 rounded-xl border border-zinc-800 flex justify-between items-center ${disabled ? 'opacity-60' : ''} ${className}`}>
      <div className="flex-1 pr-4">
        <p className="font-medium">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <button 
        disabled={disabled}
        onClick={() => onChange?.(!active)}
        className={`w-12 h-6 rounded-full transition-colors relative ${active ? 'bg-orange-500' : 'bg-zinc-700'}`}
      >
        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${active ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );
}
