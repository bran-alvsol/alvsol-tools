export const firebaseConfig = {
  apiKey: "AIzaSyCHduSAsL9nM459Nic3oOdGqw-FIwe2w7Q",
  authDomain: "alvsol-tools.firebaseapp.com",
  projectId: "alvsol-tools",
  storageBucket: "alvsol-tools.firebasestorage.app",
  messagingSenderId: "819648275266",
  appId: "1:819648275266:web:b507dac2acd51001a71edb"
};

export function isFirebaseConfigured() {
  return !Object.values(firebaseConfig).some((value) => value.startsWith("REEMPLAZA_"));
}
