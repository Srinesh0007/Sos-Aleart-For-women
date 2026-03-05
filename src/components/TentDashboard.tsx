import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Send, AlertCircle, Shield, ArrowLeft, Plus, MessageSquare, MapPin, Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { Tent, TentMessage } from '../types';

interface TentDashboardProps {
  clientId: string;
  onClose: () => void;
  onTriggerSOS: (message: string) => void;
}

export default function TentDashboard({ clientId, onClose, onTriggerSOS }: TentDashboardProps) {
  const [tents, setTents] = useState<Tent[]>([]);
  const [activeTent, setActiveTent] = useState<Tent | null>(null);
  const [newMessage, setNewMessage] = useState('');
  const [tentIdToJoin, setTentIdToJoin] = useState('');
  const [newTentName, setNewTentName] = useState('');
  const [userName, setUserName] = useState(() => localStorage.getItem('tent_user_name') || 'User');
  const [isJoining, setIsJoining] = useState(false);
  
  // Voice Call State
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [activePeers, setActivePeers] = useState<string[]>([]);
  
  const chatEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnections = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudiosRef = useRef<HTMLDivElement>(null);

  // Refs to avoid stale closures in signaling
  const isInCallRef = useRef(false);
  const activeTentIdRef = useRef<string | null>(null);

  useEffect(() => {
    isInCallRef.current = isInCall;
  }, [isInCall]);

  useEffect(() => {
    activeTentIdRef.current = activeTent?.id || null;
  }, [activeTent?.id]);

  useEffect(() => {
    fetchTents();
    
    // Setup WebSocket for real-time chat and signaling
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'TENT_MESSAGE_RECEIVED') {
          setTents(prev => prev.map(t => {
            if (t.id === data.tentId) {
              if (t.messages.some(m => m.id === data.message.id)) return t;
              return { ...t, messages: [...t.messages, data.message] };
            }
            return t;
          }));

          setActiveTent(prev => {
            if (prev && prev.id === data.tentId) {
              if (prev.messages.some(m => m.id === data.message.id)) return prev;
              return { ...prev, messages: [...prev.messages, data.message] };
            }
            return prev;
          });
        }

        // WebRTC Signaling
        if (data.type === 'TENT_SIGNAL_RECEIVED' && data.tentId === activeTentIdRef.current) {
          if (data.senderId === clientId) return; // Ignore own signals
          if (data.targetId && data.targetId !== clientId) return;
          
          console.log('📶 WebRTC Signal Received:', data.signal.type, 'from', data.senderId);
          handleSignalingData(data);
        }
      } catch (e) {
        console.error('Error parsing WS message in Tent', e);
      }
    };

    return () => {
      ws.close();
      stopCall();
    };
  }, []); // Only setup WS once

  const handleSignalingData = async (data: any) => {
    const { senderId, signal } = data;
    
    if (signal.type === 'presence') {
      if (isInCallRef.current && !peerConnections.current.has(senderId)) {
        // To avoid glare (both sides offering at once), 
        // only the client with the "higher" ID initiates the offer.
        if (clientId > senderId) {
          console.log('🚀 Initiating offer to', senderId);
          initiatePeerConnection(senderId, true);
        } else {
          console.log('⏳ Waiting for offer from', senderId);
          // We still announce presence so they know we are here
          sendSignal(senderId, { type: 'presence-ack' });
        }
      }
    } else if (signal.type === 'presence-ack') {
      if (isInCallRef.current && !peerConnections.current.has(senderId)) {
        if (clientId > senderId) {
          console.log('🚀 Initiating offer to (after ack)', senderId);
          initiatePeerConnection(senderId, true);
        }
      }
    } else if (signal.type === 'offer') {
      const pc = initiatePeerConnection(senderId, false);
      await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
      
      // Process queued ICE candidates
      if ((pc as any)._iceQueue) {
        for (const cand of (pc as any)._iceQueue) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.error('Error adding queued ICE candidate', e);
          }
        }
        delete (pc as any)._iceQueue;
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      sendSignal(senderId, { type: 'answer', sdp: answer });
    } else if (signal.type === 'answer') {
      const pc = peerConnections.current.get(senderId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp));
        
        // Process queued ICE candidates
        if ((pc as any)._iceQueue) {
          for (const cand of (pc as any)._iceQueue) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.error('Error adding queued ICE candidate', e);
            }
          }
          delete (pc as any)._iceQueue;
        }
      }
    } else if (signal.type === 'ice-candidate') {
      const pc = peerConnections.current.get(senderId);
      if (pc) {
        try {
          if (pc.remoteDescription) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } else {
            // Queue candidate if remote description not set yet
            (pc as any)._iceQueue = (pc as any)._iceQueue || [];
            (pc as any)._iceQueue.push(signal.candidate);
          }
        } catch (e) {
          console.error('Error adding ICE candidate', e);
        }
      }
    } else if (signal.type === 'hangup') {
      closePeerConnection(senderId);
    }
  };

  const sendSignal = (targetId: string | null, signal: any) => {
    if (wsRef.current && activeTent) {
      wsRef.current.send(JSON.stringify({
        type: 'TENT_SIGNAL',
        tentId: activeTent.id,
        senderId: clientId,
        targetId,
        signal
      }));
    }
  };

  const initiatePeerConnection = (peerId: string, isOffer: boolean) => {
    if (peerConnections.current.has(peerId)) return peerConnections.current.get(peerId)!;

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peerConnections.current.set(peerId, pc);
    setActivePeers(prev => [...new Set([...prev, peerId])]);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('🧊 Sending ICE candidate to', peerId);
        sendSignal(peerId, { type: 'ice-candidate', candidate: event.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`🔌 Connection state with ${peerId}:`, pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        closePeerConnection(peerId);
      }
    };

    pc.ontrack = (event) => {
      console.log('🎵 Received remote track from', peerId, event.streams);
      const stream = event.streams[0] || new MediaStream([event.track]);
      let audio = document.getElementById(`audio-${peerId}`) as HTMLAudioElement;
      if (!audio) {
        audio = document.createElement('audio');
        audio.id = `audio-${peerId}`;
        audio.autoplay = true;
        // Ensure it's not muted and volume is up
        audio.muted = false;
        audio.volume = 1.0;
        remoteAudiosRef.current?.appendChild(audio);
      }
      audio.srcObject = stream;
      
      // Play explicitly as some browsers block autoplay
      audio.play().catch(e => console.error('Error playing remote audio', e));
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    if (isOffer) {
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        sendSignal(peerId, { type: 'offer', sdp: offer });
      });
    }

    return pc;
  };

  const closePeerConnection = (peerId: string) => {
    const pc = peerConnections.current.get(peerId);
    if (pc) {
      pc.close();
      peerConnections.current.delete(peerId);
      setActivePeers(prev => prev.filter(id => id !== peerId));
      const audio = document.getElementById(`audio-${peerId}`);
      if (audio) audio.remove();
    }
  };

  const startCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setIsInCall(true);
      // Announce presence to the tent
      sendSignal(null, { type: 'presence' });
    } catch (e) {
      console.error('Failed to get user media', e);
      alert('Microphone access is required for voice calls.');
    }
  };

  const stopCall = () => {
    setIsInCall(false);
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }
    peerConnections.current.forEach((pc, peerId) => {
      closePeerConnection(peerId);
    });
    sendSignal(null, { type: 'hangup' });
  };

  const toggleMute = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      audioTrack.enabled = !audioTrack.enabled;
      setIsMuted(!audioTrack.enabled);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTent?.messages]);

  const fetchTents = async () => {
    try {
      const res = await fetch('/api/tents');
      const data = await res.json();
      setTents(data);
    } catch (e) {
      console.error('Failed to fetch tents', e);
    }
  };

  const handleJoinOrCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const id = tentIdToJoin || Math.random().toString(36).substring(2, 9);
    
    try {
      const res = await fetch('/api/tents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          name: newTentName || `Circle ${id.slice(0, 4)}`,
          member: { id: clientId, name: userName }
        })
      });
      const data = await res.json();
      setActiveTent(data);
      setIsJoining(false);
      fetchTents();
      localStorage.setItem('tent_user_name', userName);
    } catch (e) {
      console.error('Failed to join/create tent', e);
    }
  };

  const sendMessage = (isEmergency = false) => {
    if ((!newMessage.trim() && !isEmergency) || !activeTent || !wsRef.current) return;

    const msg: TentMessage = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: clientId,
      senderName: userName,
      text: isEmergency ? "🚨 EMERGENCY TRIGGERED IN THIS CIRCLE!" : newMessage,
      timestamp: new Date(),
      isEmergency
    };

    wsRef.current.send(JSON.stringify({
      type: 'TENT_MESSAGE',
      tentId: activeTent.id,
      message: msg
    }));

    if (isEmergency) {
      onTriggerSOS(`Emergency triggered in ${activeTent.name}`);
    }

    setNewMessage('');
  };

  return (
    <div className="h-full w-full bg-zinc-950 text-white flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-zinc-800 flex items-center gap-4 bg-zinc-900/50 backdrop-blur-md">
        <button onClick={activeTent ? () => setActiveTent(null) : onClose} className="p-2 hover:bg-zinc-800 rounded-full">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold">{activeTent ? activeTent.name : 'Safe Tents'}</h1>
          <p className="text-xs text-zinc-500">{activeTent ? `${activeTent.members.length} Members` : 'Your Safe Circles'}</p>
        </div>
        {activeTent && (
          <button 
            onClick={isInCall ? stopCall : startCall}
            className={`p-2 rounded-full transition-colors ${isInCall ? 'bg-red-600 hover:bg-red-500' : 'bg-green-600 hover:bg-green-500'}`}
            title={isInCall ? "Leave Voice Call" : "Join Voice Call"}
          >
            {isInCall ? <PhoneOff size={20} /> : <Phone size={20} />}
          </button>
        )}
        {!activeTent && (
          <button 
            onClick={() => setIsJoining(true)}
            className="p-2 bg-blue-600 rounded-full hover:bg-blue-500 transition-colors"
          >
            <Plus size={20} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-hidden relative">
        <AnimatePresence mode="wait">
          {isJoining ? (
            <motion.div 
              key="join-form"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.05 }}
              className="absolute inset-0 p-6 flex flex-col items-center justify-center bg-zinc-950 z-20"
            >
              <form onSubmit={handleJoinOrCreate} className="w-full max-w-sm space-y-6">
                <div className="text-center space-y-2 mb-8">
                  <div className="w-16 h-16 bg-blue-600/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Shield className="text-blue-500" size={32} />
                  </div>
                  <h2 className="text-2xl font-bold">Create or Join a Tent</h2>
                  <p className="text-zinc-400 text-sm">Safe circles for you and your trusted contacts.</p>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-xs font-bold text-zinc-500 uppercase mb-1 block">Your Name</label>
                    <input 
                      type="text" 
                      value={userName}
                      onChange={(e) => setUserName(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 focus:outline-none focus:border-blue-500"
                      placeholder="Enter your name"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-zinc-500 uppercase mb-1 block">Tent ID (to join) or Name (to create)</label>
                    <input 
                      type="text" 
                      value={tentIdToJoin}
                      onChange={(e) => setTentIdToJoin(e.target.value)}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 focus:outline-none focus:border-blue-500"
                      placeholder="Leave empty to create new"
                    />
                  </div>
                  {(!tentIdToJoin) && (
                    <div>
                      <label className="text-xs font-bold text-zinc-500 uppercase mb-1 block">Tent Name</label>
                      <input 
                        type="text" 
                        value={newTentName}
                        onChange={(e) => setNewTentName(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 focus:outline-none focus:border-blue-500"
                        placeholder="e.g. Family, Close Friends"
                      />
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsJoining(false)}
                    className="flex-1 py-3 bg-zinc-900 border border-zinc-800 rounded-xl font-bold"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-3 bg-blue-600 rounded-xl font-bold hover:bg-blue-500 transition-colors"
                  >
                    {tentIdToJoin ? 'Join Tent' : 'Create Tent'}
                  </button>
                </div>
              </form>
            </motion.div>
          ) : activeTent ? (
            <motion.div 
              key="chat"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="absolute inset-0 flex flex-col"
            >
              {/* Messages Area */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {isInCall && (
                  <div className="bg-green-600/10 border border-green-600/20 rounded-2xl p-4 mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-sm font-bold text-green-500">Voice Call Active</span>
                      <span className="text-xs text-zinc-500">({activePeers.length + 1} in call)</span>
                    </div>
                    <button 
                      onClick={toggleMute}
                      className={`p-2 rounded-lg transition-colors ${isMuted ? 'bg-red-600/20 text-red-500' : 'bg-zinc-800 text-zinc-400'}`}
                    >
                      {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
                    </button>
                  </div>
                )}
                {activeTent.messages.map((msg) => (
                  <div 
                    key={msg.id} 
                    className={`flex flex-col ${msg.senderId === clientId ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase">{msg.senderName}</span>
                      <span className="text-[10px] text-zinc-600">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div className={`max-w-[80%] p-3 rounded-2xl ${
                      msg.isEmergency 
                        ? 'bg-red-600 text-white font-bold animate-pulse border-2 border-red-400' 
                        : msg.senderId === clientId 
                          ? 'bg-blue-600 text-white rounded-tr-none' 
                          : 'bg-zinc-800 text-zinc-200 rounded-tl-none'
                    }`}>
                      {msg.text}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Input Area */}
              <div className="p-4 bg-zinc-900/80 border-t border-zinc-800 flex flex-col gap-3">
                <div className="flex gap-2">
                  <button 
                    onClick={() => sendMessage(true)}
                    className="p-3 bg-red-600/20 text-red-500 border border-red-600/30 rounded-xl hover:bg-red-600/30 transition-colors flex items-center gap-2"
                    title="Trigger Emergency in this Circle"
                  >
                    <AlertCircle size={20} />
                    <span className="text-xs font-bold uppercase">Emergency</span>
                  </button>
                  <div className="flex-1 relative">
                    <input 
                      type="text"
                      value={newMessage}
                      onChange={(e) => setNewMessage(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
                      placeholder="Message circle..."
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 pr-12 focus:outline-none focus:border-blue-500"
                    />
                    <button 
                      onClick={() => sendMessage()}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-blue-500 hover:text-blue-400"
                    >
                      <Send size={20} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div 
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 overflow-y-auto p-4 space-y-3"
            >
              {tents.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4">
                  <div className="p-6 bg-zinc-900 rounded-full">
                    <Users size={48} className="text-zinc-700" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold">No Tents Yet</h3>
                    <p className="text-zinc-500 text-sm">Create a safe circle for your family or friends to stay connected and protected.</p>
                  </div>
                  <button 
                    onClick={() => setIsJoining(true)}
                    className="px-6 py-3 bg-blue-600 rounded-xl font-bold hover:bg-blue-500 transition-colors"
                  >
                    Create Your First Tent
                  </button>
                </div>
              ) : (
                tents.map((tent) => (
                  <button
                    key={tent.id}
                    onClick={() => setActiveTent(tent)}
                    className="w-full p-4 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center gap-4 hover:bg-zinc-800 transition-colors text-left group"
                  >
                    <div className="w-12 h-12 bg-blue-600/10 rounded-xl flex items-center justify-center text-blue-500 group-hover:bg-blue-600/20 transition-colors">
                      <Shield size={24} />
                    </div>
                    <div className="flex-1">
                      <h3 className="font-bold">{tent.name}</h3>
                      <p className="text-xs text-zinc-500">{tent.members.length} Members • ID: {tent.id}</p>
                    </div>
                    <div className="text-zinc-600">
                      <MessageSquare size={18} />
                    </div>
                  </button>
                ))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div ref={remoteAudiosRef} className="fixed pointer-events-none opacity-0" aria-hidden="true" />
    </div>
  );
}
