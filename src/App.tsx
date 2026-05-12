import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Send,
  Plus,
  Trash2,
  Menu,
  X,
  FileText,
  Camera,
  Cpu,
  User as UserIcon,
  Paperclip,
  Loader2,
  Settings,
  LogIn,
  LogOut,
  AlertCircle,
  Mic,
  Square,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GoogleGenAI } from "@google/genai";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from "firebase/auth";
import { 
  getFirestore, 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp, 
  Timestamp,
  getDocFromServer
} from "firebase/firestore";
import firebaseConfig from "../firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

const SYSTEM_PROMPT = `أنت "بوزا" (Boza)، مساعد برمجي فائق الذكاء ومهندس مشاريع خبير (Software Architect).
قدراتك الأساسية تشمل:
1. **إنشاء مشاريع كاملة (Full Project Scaffolding)**: أنت محترف في تصميم بنية المشاريع من الصفر، تحديد تقسيم المجلدات، واختيار أفضل التقنيات (Tech Stack).
2. **الـ Debugging المتقدم**: اكتشاف الأخطاء البرمجية وتقديم حلول جذرية.
3. **الوعي الكامل بالسياق (Context Awareness)**: تعامل مع الملفات كجزء من نظام متكامل.
4. **خبير سطر الأوامر (CLI Native)** ومهام **Git**.

عندما يطلب منك المستخدم إنشاء مشروع:
- ابدأ برسم هيكلية المجلدات (File Tree).
- اشرح دور كل جزء في المشروع.
- قدم الكود لكل ملف بشكل منظم مع استخدام Markdown.`;

const WELCOME_MESSAGE = `# مرحباً BOZA 🚀

لقد تم تحديثي لأكون **مهندس مشاريعك الشخصي**. أنا الآن أدعم:
- 🏗️ **إنشاء مشاريع كاملة**: اصمم لك بنية المشروع والكود من الصفر.
- 🐛 **Debugging خارق**: سأكتشف لك الأخطاء المعقدة.
- 🐚 **CLI & Terminal**: أرسل لي أي مشكلة في سطر الأوامر وسأحلها.
- 🐙 **إدارة Git**: مساعدك الشخصي في التعامل مع المستودعات.

**اضغط على "مهندس المشاريع" في القائمة الجانبية لنبدأ بناء مشروعك القادم!**`;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const DEFAULT_MODEL = "gemini-3-flash-preview"; 
const PRO_MODEL = "gemini-3.1-pro-preview"; 

interface Attachment {
  type: "image" | "pdf" | "text" | "audio";
  mediaType: string;
  data: string;
  name: string;
  preview?: string;
  content?: string;
}

interface Message {
  role: "user" | "assistant";
  content: any;
  displayContent?: string;
  attachments?: Attachment[];
}

interface UserStats {
  requestsToday: number;
  windowStart: Timestamp;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: WELCOME_MESSAGE, displayContent: WELCOME_MESSAGE },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [userStats, setUserStats] = useState<UserStats | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const audioChunksRef = useRef<Blob[]>([]);

  // Real-time suggestions logic
  useEffect(() => {
    if (!input.trim() || input.length < 3 || loading) {
      setSuggestions([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSuggesting(true);
        const result = await ai.models.generateContent({
          model: DEFAULT_MODEL,
          contents: [{ role: 'user', parts: [{ text: `Based on this partial input: "${input}", give me 3 short, helpful ways to complete this sentence or question. Output only the 3 suggestions separated by | and nothing else. No numbers.` }] }],
        });
        const text = result.text || "";
        const parts = text.split('|').map(s => s.trim()).filter(s => s.length > 0).slice(0, 3);
        setSuggestions(parts);
      } catch (err) {
        console.error("Suggestion error:", err);
      } finally {
        setIsSuggesting(false);
      }
    }, 800); // 800ms debounce

    return () => clearTimeout(timer);
  }, [input, loading]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64 = reader.result as string;
          const pureBase64 = base64.split(',')[1];
          const voiceAttachment: Attachment = {
            type: "audio",
            mediaType: "audio/wav",
            data: pureBase64,
            name: `صوت ${new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}`
          };
          
          // Auto-send voice for seamless "Talk to Boza" experience
          handleSendMessage([voiceAttachment]);
        };
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setRecorder(mediaRecorder);
      setIsRecording(true);
    } catch (err) {
      console.error("Mic error:", err);
      alert("تعذر الوصول للميكروفون. يرجى التأكد من منح الإذن.");
    }
  };

  const stopRecording = () => {
    if (recorder) {
      recorder.stop();
      setIsRecording(false);
      setRecorder(null);
    }
  };

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  // Connection test
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setAuthLoading(false);
      if (user) {
        fetchUserStats(user.uid);
      } else {
        setUserStats(null);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const fetchUserStats = async (uid: string) => {
    try {
      const userDoc = await getDoc(doc(db, "users", uid));
      if (userDoc.exists()) {
        setUserStats(userDoc.data() as UserStats);
      } else {
        setUserStats({ requestsToday: 0, windowStart: Timestamp.now() });
      }
    } catch (err) {
      console.error("Error fetching stats:", err);
    }
  };

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error("Login failed:", err);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      setMessages([{ role: "assistant", content: WELCOME_MESSAGE, displayContent: WELCOME_MESSAGE }]);
    } catch (err) {
      console.error("Logout failed:", err);
    }
  };

  const resetChat = () => {
    setMessages([{ role: "assistant", content: WELCOME_MESSAGE, displayContent: WELCOME_MESSAGE }]);
    setAttachments([]);
  };

  const fileToBase64 = (file: File): Promise<string> =>
    new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res((r.result as string).split(",")[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });

  const processFile = async (file: File): Promise<Attachment | null> => {
    const maxSize = 15 * 1024 * 1024;
    if (file.size > maxSize) {
      alert("الملف كبير جداً (الحد الأقصى 15MB)");
      return null;
    }

    try {
      const base64 = await fileToBase64(file);
      const type = file.type;

      if (type.startsWith("image/")) {
        return {
          type: "image",
          mediaType: type,
          data: base64,
          name: file.name,
          preview: URL.createObjectURL(file),
        };
      } else if (type === "application/pdf") {
        return {
          type: "pdf",
          mediaType: type,
          data: base64,
          name: file.name,
        };
      } else if (
        type.startsWith("text/") ||
        type.includes("javascript") ||
        type.includes("json") ||
        type.includes("typescript") ||
        /\.(ts|tsx|js|jsx|py|go|rs|c|cpp|h|css|html|md|json)$/i.test(file.name)
      ) {
        const binString = atob(base64);
        const bytes = new Uint8Array(binString.length);
        for (let i = 0; i < binString.length; i++) {
          bytes[i] = binString.charCodeAt(i);
        }
        const text = new TextDecoder().decode(bytes);
        return {
          type: "text",
          mediaType: "text/plain",
          data: base64,
          name: file.name,
          content: text,
        };
      }
      alert("عذراً، هذا النوع من الملفات غير مدعوم حالياً.");
      return null;
    } catch (err) {
      console.error(err);
      return null;
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const results = await Promise.all(Array.from(files).map(processFile));
    setAttachments((prev) => [...prev, ...results.filter((r): r is Attachment => r !== null)]);
  };

  const handleSendMessage = async (overrideAttachments?: Attachment[]) => {
    if (!currentUser) { login(); return; }
    
    const text = input.trim();
    const currentAttachments = overrideAttachments || [...attachments];
    if ((!text && currentAttachments.length === 0) || loading) return;

    if (!process.env.GEMINI_API_KEY) {
      alert("يرجى إضافة مفتاح API (GEMINI_API_KEY) في قائمة الإعدادات (Settings) داخل AI Studio لتتمكن من استخدام التطبيق ونشره.");
      return;
    }

    // Rate Limit Check
    const now = Date.now();
    const windowStart = userStats?.windowStart.toMillis() || 0;
    const isWindowExpired = now - windowStart > 24 * 60 * 60 * 1000;
    
    if (!isWindowExpired && userStats && userStats.requestsToday >= 1000) {
      const nextReset = new Date(windowStart + 24 * 60 * 60 * 1000);
      alert(`لقد وصلت للحد الأقصى (1000 طلب كل 24 ساعة). يمكنك المحاولة مرة أخرى في: ${nextReset.toLocaleTimeString()}`);
      return;
    }

    const currentInput = text;
    // currentAttachments is already defined from arguments or state
    setInput("");
    if (!overrideAttachments) setAttachments([]);
    if (inputRef.current) inputRef.current.style.height = "auto";

    const parts: any[] = [];
    currentAttachments.forEach(att => {
      if (att.type === 'image' || att.type === 'pdf' || att.type === 'audio') {
        parts.push({
          inlineData: {
            mimeType: att.mediaType,
            data: att.data
          }
        });
      } else if (att.type === 'text') {
        parts.push({ text: `File: ${att.name}\n\`\`\`\n${att.content}\n\`\`\`` });
      }
    });
    if (currentInput) parts.push({ text: currentInput });

    const userDisplayMsg: Message = {
      role: "user",
      content: parts,
      displayContent: currentInput || (currentAttachments.length > 0 ? "📎 " + currentAttachments.map(a => a.name).join(", ") : ""),
      attachments: currentAttachments
    };

    setMessages((prev) => [...prev, userDisplayMsg]);
    setLoading(true);

    try {
      // 1. Kick off Firestore update in background (don't await it immediately to start AI faster)
      const firestorePromise = (async () => {
        const userDocRef = doc(db, "users", currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        let currentStats: { requestsToday: number; windowStart: Timestamp };

        if (!userDoc.exists()) {
          currentStats = {
            requestsToday: 1,
            windowStart: Timestamp.now()
          };
          await setDoc(userDocRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            requestsToday: 1,
            windowStart: serverTimestamp(),
            lastRequestAt: serverTimestamp()
          }).catch(e => handleFirestoreError(e, OperationType.CREATE, "users/" + currentUser.uid));
        } else {
          const data = userDoc.data() as any;
          const expired = Date.now() - data.windowStart.toMillis() > 24 * 60 * 60 * 1000;
          
          if (expired) {
            currentStats = { requestsToday: 1, windowStart: Timestamp.now() };
            await updateDoc(userDocRef, {
              requestsToday: 1,
              windowStart: serverTimestamp(),
              lastRequestAt: serverTimestamp()
            }).catch(e => handleFirestoreError(e, OperationType.UPDATE, "users/" + currentUser.uid));
          } else {
            currentStats = { requestsToday: data.requestsToday + 1, windowStart: data.windowStart };
            await updateDoc(userDocRef, {
              requestsToday: data.requestsToday + 1,
              lastRequestAt: serverTimestamp()
            }).catch(e => handleFirestoreError(e, OperationType.UPDATE, "users/" + currentUser.uid));
          }
        }
        return currentStats;
      })();

      // 2. Prepare AI History
      const history = messages
        .filter((_, idx) => idx > 0)
        .map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: typeof m.content === 'string' ? [{ text: m.content }] : (Array.isArray(m.content) ? m.content : [{ text: String(m.content) }])
        }));

      // 3. Start Streaming
      const result = await ai.models.generateContentStream({
        model: currentAttachments.length > 0 ? PRO_MODEL : DEFAULT_MODEL,
        contents: [...history, { role: 'user', parts }],
        config: { systemInstruction: SYSTEM_PROMPT }
      });

      // Add a placeholder assistant message
      setMessages(prev => [...prev, { role: "assistant", content: "", displayContent: "" }]);
      
      let fullText = "";
      for await (const chunk of result) {
        const chunkText = chunk.text;
        if (chunkText) {
          fullText += chunkText;
          setMessages(prev => {
            const updated = [...prev];
            const lastMsg = updated[updated.length - 1];
            if (lastMsg && lastMsg.role === "assistant") {
              lastMsg.content = fullText;
              lastMsg.displayContent = fullText;
            }
            return updated;
          });
        }
      }

      // Sync user stats after interaction
      const finalStats = await firestorePromise;
      setUserStats(finalStats);

    } catch (err: any) {
      setMessages((prev) => [...prev, { role: "assistant", content: "❌ خطأ: " + err.message, displayContent: "❌ خطأ: " + err.message }]);
    } finally {
      setLoading(false);
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => {
      const updated = [...prev];
      if (updated[idx].preview) URL.revokeObjectURL(updated[idx].preview!);
      updated.splice(idx, 1);
      return updated;
    });
  };

  if (authLoading) {
    return (
      <div className="h-screen w-full bg-[#0a0a0f] flex items-center justify-center">
        <Loader2 className="animate-spin text-orange-500" size={48} />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="h-screen w-full bg-[#0a0a0f] flex flex-col items-center justify-center p-4 md:p-6 text-center" dir="rtl">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-[#0f0f1a] border border-white/5 p-6 md:p-8 rounded-2xl md:rounded-3xl shadow-2xl"
        >
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-2xl bg-gradient-to-br from-orange-400 to-amber-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-orange-500/20">
            <Cpu className="text-white" size={32} />
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-white mb-2">BOZA AI</h1>
          <p className="text-sm md:text-base text-white/60 mb-8 leading-relaxed">أهلاً بك في مساعدك الذكي المتقدم. يرجى تسجيل الدخول باستخدام حساب جوجل للبدء واستخدام 1000 محاولة مجانية يومياً.</p>
          <button 
            onClick={login}
            className="w-full h-12 md:h-14 bg-white text-black font-bold rounded-xl md:rounded-2xl flex items-center justify-center gap-3 hover:bg-white/90 transition-all active:scale-95"
          >
            <LogIn size={20} />
            <span>تسجيل الدخول بـ Google</span>
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-full bg-[#0a0a0f] text-[#e8e8f0] font-sans selection:bg-[#f5a623]/30 overflow-hidden"
      dir="rtl"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <AnimatePresence>
        {dragging && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-amber-500/10 backdrop-blur-sm border-4 border-dashed border-amber-500/50 flex items-center justify-center pointer-events-none"
          >
            <div className="bg-[#0f0f1a] p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-4 text-amber-500">
              <Paperclip size={48} className="animate-bounce" />
              <span className="text-xl font-bold text-center">أفلت الملفات هنا للتحليل</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden"
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              className="fixed right-0 top-0 bottom-0 z-50 w-72 bg-[#0f0f1a] border-l border-white/5 flex flex-col md:hidden"
            >
              <div className="p-4 flex justify-between items-center border-b border-white/5">
                <span className="font-black text-orange-400">القائمة</span>
                <button onClick={() => setSidebarOpen(false)} className="p-2 hover:bg-white/5 rounded-lg">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
                <button
                  onClick={() => { resetChat(); setSidebarOpen(false); }}
                  className="w-full flex items-center justify-center gap-2 bg-[#f5a623] text-black font-bold py-3 rounded-xl transition-all"
                >
                  <Plus size={18} />
                  <span>محادثة جديدة</span>
                </button>
                <button
                  onClick={() => {
                    resetChat();
                    setSidebarOpen(false);
                    setTimeout(() => {
                      setInput("أريد إنشاء مشروع كامل. صمم لي هيكلية المشروع والكود لبرنامج: [أدخل اسم المشروع هنا]");
                      inputRef.current?.focus();
                    }, 100);
                  }}
                  className="w-full flex items-center justify-center gap-2 bg-white/5 text-orange-400 border border-orange-500/20 py-3 rounded-xl text-sm"
                >
                  <Cpu size={18} />
                  <span>مهندس المشاريع 🏗️</span>
                </button>
                <nav className="space-y-1 pt-4">
                  <div className="text-[10px] uppercase tracking-widest text-white/30 px-3 py-2 font-bold">الأدوات</div>
                  <button onClick={() => { fileRef.current?.click(); setSidebarOpen(false); }} className="w-full p-3 hover:bg-white/5 rounded-lg flex items-center gap-3 text-white/60">
                    <Paperclip size={16} className="text-orange-400" />
                    <div className="text-xs">رفع ملف</div>
                  </button>
                  <button onClick={() => { cameraRef.current?.click(); setSidebarOpen(false); }} className="w-full p-3 hover:bg-white/5 rounded-lg flex items-center gap-3 text-white/60">
                    <Camera size={16} className="text-orange-400" />
                    <div className="text-xs">التقاط صورة</div>
                  </button>
                </nav>
              </div>
              <div className="p-4 border-t border-white/5 bg-black/20">
                <div className="flex items-center gap-3 mb-4">
                  <img src={currentUser.photoURL || ""} className="w-8 h-8 rounded-full border border-white/10" alt="avatar" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-bold truncate">{currentUser.displayName}</div>
                  </div>
                  <button onClick={logout} className="p-2 text-white/40 hover:text-red-400">
                    <LogOut size={16} />
                  </button>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Sidebar Desktop */}
      <aside className="hidden md:flex flex-col w-[260px] bg-[#0f0f1a] border-l border-white/5 shrink-0">
        <div className="p-6 space-y-4">
          <button
            onClick={resetChat}
            className="w-full flex items-center justify-center gap-2 bg-[#f5a623] hover:bg-[#ff6b35] text-black font-bold py-3 rounded-xl transition-all shadow-lg shadow-orange-500/10 active:scale-95"
          >
            <Plus size={18} />
            <span>محادثة جديدة</span>
          </button>

          <button
            onClick={() => {
              resetChat();
              setTimeout(() => {
                setInput("أريد إنشاء مشروع كامل. صمم لي هيكلية المشروع والكود لبرنامج: [أدخل اسم المشروع هنا]");
                inputRef.current?.focus();
              }, 100);
            }}
            className="w-full flex items-center justify-center gap-2 bg-white/5 hover:bg-white/10 text-orange-400 border border-orange-500/20 py-3 rounded-xl transition-all active:scale-95 text-sm"
          >
            <Cpu size={18} />
            <span>مهندس المشاريع 🏗️</span>
          </button>
        </div>

        <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar">
          <div className="text-[11px] uppercase tracking-widest text-white/30 px-3 py-2 font-bold">الأدوات</div>
          <button onClick={() => fileRef.current?.click()} className="w-full p-3 hover:bg-white/5 rounded-lg flex items-center gap-3 cursor-pointer text-white/60 transition-colors group">
            <Paperclip size={16} className="text-orange-400 group-hover:scale-110 transition-transform" />
            <div className="text-xs truncate">رفع ملف أو مستند</div>
          </button>
          <button onClick={() => cameraRef.current?.click()} className="w-full p-3 hover:bg-white/5 rounded-lg flex items-center gap-3 cursor-pointer text-white/60 transition-colors group">
            <Camera size={16} className="text-orange-400 group-hover:scale-110 transition-transform" />
            <div className="text-xs truncate">التقاط صورة</div>
          </button>
        </nav>

        <div className="p-4 border-t border-white/5 bg-black/20">
          <div className="flex items-center gap-3 mb-4">
            <img src={currentUser.photoURL || ""} className="w-10 h-10 rounded-full border border-white/10" alt="avatar" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold truncate">{currentUser.displayName}</div>
              <div className="text-[10px] text-white/40 truncate">{currentUser.email}</div>
            </div>
          </div>
          
          <div className="space-y-2 mb-4">
             <div className="flex justify-between text-[10px] mb-1">
               <span className="text-white/40">استهلاك اليوم:</span>
               <span className="text-orange-400 font-bold">{userStats?.requestsToday ?? 0} / 1000</span>
             </div>
             <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
               <motion.div 
                 initial={{ width: 0 }}
                 animate={{ width: `${Math.min(((userStats?.requestsToday ?? 0) / 1000) * 100, 100)}%` }}
                 className="h-full bg-orange-500" 
               />
             </div>
          </div>

          <button onClick={logout} className="w-full py-2 bg-white/5 hover:bg-red-500/10 hover:text-red-400 rounded-lg text-white/40 text-xs flex items-center justify-center gap-2 transition-all">
            <LogOut size={14} />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col relative h-full w-full overflow-hidden">
        <header className="h-14 md:h-16 border-b border-white/5 flex items-center justify-between px-4 md:px-6 bg-[#0a0a0f]/80 backdrop-blur-xl sticky top-0 z-30">
          <div className="flex items-center gap-3 md:gap-4">
            <button onClick={() => setSidebarOpen(true)} className="p-2 -mr-1 md:hidden hover:bg-white/5 rounded-lg text-white/60 active:scale-95 transition-transform">
              <Menu size={22} />
            </button>
            <div className="text-xl md:text-2xl font-black italic tracking-tighter bg-gradient-to-l from-orange-400 to-amber-200 bg-clip-text text-transparent select-none">BOZA AI</div>
          </div>
          <div className="flex items-center gap-1 md:gap-2">
             <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 bg-orange-500/10 border border-orange-500/20 rounded-full text-orange-400 text-[10px] font-bold">
               {userStats?.requestsToday || 0}/1k
             </div>
             <div className="sm:hidden text-[10px] text-orange-400 font-bold px-2 py-1 bg-orange-500/5 rounded-lg">
               {userStats?.requestsToday || 0}
             </div>
             <button onClick={resetChat} className="p-2 hover:bg-red-500/10 hover:text-red-400 rounded-lg text-white/40 transition-colors text-right" dir="ltr">
               <Trash2 size={20} />
             </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-8 space-y-6 md:space-y-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto w-full space-y-8">
            {messages.map((msg, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-start gap-4 ${msg.role === "assistant" ? "flex-row" : "flex-row-reverse"}`}
              >
                <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center text-xs md:text-sm shrink-0 shadow-lg relative ${
                  msg.role === "assistant"
                    ? "bg-gradient-to-br from-orange-400 to-amber-600 shadow-orange-500/20 text-white"
                    : "bg-white/10 text-white/40 border border-white/10"
                }`}>
                  {msg.role === "assistant" ? <Cpu size={18} /> : <UserIcon size={18} />}
                </div>

                <div className={`flex flex-col gap-3 md:gap-4 w-full md:max-w-[85%] ${msg.role === "user" ? "items-end" : "items-start"}`}>
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-end">
                      {msg.attachments.map((att, j) => (
                        <div key={j} className="group relative">
                           {att.type === 'image' ? (
                             <img src={att.preview} className="max-w-[200px] md:max-w-[240px] rounded-lg md:rounded-xl border border-white/10 shadow-lg" alt={att.name} />
                           ) : (
                             <div className="flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 bg-white/5 border border-white/10 rounded-lg md:rounded-xl text-[10px] md:text-xs text-orange-400">
                               {att.type === 'pdf' ? <FileText size={16} /> : att.type === 'audio' ? <Mic size={16} /> : <Paperclip size={16} />}
                               <span className="truncate max-w-[120px] md:max-w-[150px]">{att.name}</span>
                             </div>
                           )}
                        </div>
                      ))}
                    </div>
                  )}

                  <div className={`text-sm md:text-base leading-relaxed ${
                    msg.role === "assistant" ? "text-white/90 prose prose-invert prose-orange prose-sm md:prose-base max-w-none w-full" : "bg-white/5 border border-white/10 p-3 md:p-4 rounded-xl md:rounded-2xl rounded-tr-none text-white/80"
                  }`}>
                    {msg.role === "assistant" ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
                        code({node, inline, className, children, ...props}: any) {
                          const match = /language-(\w+)/.exec(className || '');
                          return !inline && match ? (
                             <div className="bg-[#0d1117] border border-white/10 rounded-xl overflow-hidden font-mono text-[13px] my-6">
                               <div className="bg-white/5 px-4 py-2 flex justify-between items-center border-b border-white/5">
                                 <span className="text-white/40 text-[10px] uppercase font-bold">{match[1]}</span>
                                 <button className="text-[10px] text-orange-400 hover:text-orange-300 transition-colors font-bold" onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ''))}>نسخ</button>
                               </div>
                               <div className="p-4 text-[#c9d1d9] leading-6 overflow-x-auto ltr">
                                 <code className="!font-mono" {...props}>{children}</code>
                               </div>
                             </div>
                          ) : (
                            <code className="bg-orange-500/10 text-orange-400 px-1.5 py-0.5 rounded font-mono text-[0.9em]" {...props}>{children}</code>
                          )
                        }
                      }}>{msg.displayContent || ""}</ReactMarkdown>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.displayContent}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}

            {loading && (
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-400 to-amber-600 flex items-center justify-center text-sm shrink-0 animate-pulse transition-all text-white">
                  <Cpu size={20} />
                </div>
                <div className="bg-white/5 border border-white/10 p-4 rounded-2xl animate-pulse flex items-center gap-1.5 shadow-xl">
                   <div className="w-4 h-4 border-2 border-orange-500/20 border-t-orange-500 rounded-full animate-spin"></div>
                   <span className="text-sm text-orange-400 font-bold opacity-80 italic">جاري التفكير...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} className="h-4" />
          </div>
        </div>

        <div className="p-3 md:p-6 bg-gradient-to-t from-[#0a0a0f] via-[#0a0a0f] to-transparent">
          <div className="max-w-[800px] mx-auto relative group w-full">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-orange-500/20 to-amber-500/20 rounded-2xl blur opacity-0 group-focus-within:opacity-100 transition duration-500 hidden md:block"></div>
            <div className="relative bg-[#13131f] border border-white/10 rounded-2xl p-1.5 md:p-2 shadow-2xl">
              <AnimatePresence>
                {attachments.length > 0 && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="flex gap-2 mb-2 p-2 overflow-x-auto custom-scrollbar">
                    {attachments.map((att, i) => (
                      <div key={i} className="px-2 py-1 bg-white/5 border border-white/10 rounded flex items-center gap-2 text-[10px] shrink-0">
                         <span className="text-orange-400">
                           {att.type === 'image' ? '🖼️' : att.type === 'pdf' ? '📄' : att.type === 'audio' ? '🎙️' : '📝'}
                         </span>
                         <span className="truncate max-w-[120px] text-white/70">{att.name}</span>
                         <button onClick={() => removeAttachment(i)} className="hover:text-red-400 text-white/30 transition-colors">✕</button>
                      </div>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
              
              <AnimatePresence>
                {suggestions.length > 0 && !loading && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="flex flex-wrap gap-2 mb-3 px-1"
                  >
                    <div className="w-full flex items-center gap-2 mb-1 opacity-50">
                      <div className="w-1 h-1 bg-orange-500 rounded-full animate-pulse" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-orange-400">مقترحات</span>
                    </div>
                    {suggestions.map((s, i) => (
                      <motion.button
                        key={i}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        onClick={() => {
                          setInput(s);
                          setSuggestions([]);
                          if (inputRef.current) {
                            inputRef.current.style.height = "auto";
                            setTimeout(() => {
                              if (inputRef.current) {
                                inputRef.current.style.height = Math.min(inputRef.current.scrollHeight, 192) + "px";
                                inputRef.current.focus();
                              }
                            }, 10);
                          }
                        }}
                        className="px-3 py-1.5 bg-white/5 hover:bg-orange-500/10 border border-white/10 hover:border-orange-500/30 rounded-lg text-xs text-white/60 hover:text-orange-400 transition-all flex items-center gap-2 shadow-sm whitespace-nowrap"
                      >
                        <span className="opacity-40">✨</span>
                        {s}
                      </motion.button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-end gap-2">
                <div className="flex gap-1 pb-1">
                  <button onClick={() => fileRef.current?.click()} className="w-10 h-10 flex items-center justify-center text-xl hover:bg-white/5 rounded-xl transition-colors text-white/40" title="إرفاق ملف">📎</button>
                  <button onClick={() => cameraRef.current?.click()} className="w-10 h-10 flex items-center justify-center text-xl hover:bg-white/5 rounded-xl transition-colors text-white/40" title="التقاط صورة">📷</button>
                </div>
                <textarea 
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-sm py-3 px-2 resize-none placeholder:text-white/20 min-h-[48px] max-h-48 leading-relaxed font-sans"
                  placeholder={userStats && userStats.requestsToday >= 1000 ? "لقد وصلت للحد الأقصى لليوم..." : "اسأل Boza عن أي شيء..."}
                  disabled={userStats && userStats.requestsToday >= 1000}
                  rows={1}
                  onInput={(e: any) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 192) + "px"; }}
                />
                <div className="flex gap-2">
                  {!input.trim() && attachments.length === 0 && !loading && (
                    <button 
                      onClick={isRecording ? stopRecording : startRecording}
                      className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all ${isRecording ? 'bg-red-500 text-white animate-pulse' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                    >
                      {isRecording ? <Square size={20} fill="white" /> : <Mic size={20} />}
                    </button>
                  )}
                  <button onClick={() => handleSendMessage()} disabled={(!input.trim() && attachments.length === 0) || loading || (userStats && userStats.requestsToday >= 1000)} className="w-12 h-12 bg-gradient-to-tr from-orange-500 to-orange-600 rounded-xl flex items-center justify-center text-black font-bold shadow-lg shadow-orange-500/20 transform hover:scale-105 active:scale-95 transition-all disabled:opacity-30 disabled:scale-100 group">
                    {loading ? <Loader2 size={24} className="animate-spin text-black/60" /> : <Send size={20} className="transform group-hover:translate-x-0.5 transition-transform" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Hidden Inputs */}
      <input ref={fileRef} type="file" multiple accept="image/*,.pdf,.txt,.js,.py,.ts,.tsx,.json,.html,.css,.md" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
    </div>
  );
}
