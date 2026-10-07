import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
import { firebaseConfig, FUNCTIONS_REGION } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = 'ko'; // 비밀번호 재설정 메일 · 재설정 화면을 한국어로
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

export {
  onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile, verifyPasswordResetCode, confirmPasswordReset, sendEmailVerification, applyActionCode,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

export {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, serverTimestamp, Timestamp, writeBatch,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

export { ref as storageRef, uploadBytes, uploadBytesResumable, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
export { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';
