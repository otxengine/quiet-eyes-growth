import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';

export default function JoinPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const token = searchParams.get('token');

  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMsg('קישור ההצטרפות אינו תקין.');
      return;
    }

    if (isLoadingAuth) return;

    if (!isAuthenticated) {
      // Redirect to sign-up, then come back with the token
      navigate(`/sign-up?redirect_url=/join?token=${token}`);
      return;
    }

    // Authenticated — claim the invite
    setStatus('loading');
    fetch(`/api/orgs/join/${token}`, { method: 'POST' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || 'שגיאה בהצטרפות לארגון');
        }
        return data;
      })
      .then(() => {
        setStatus('success');
        setTimeout(() => navigate('/dashboard'), 2000);
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err.message);
      });
  }, [token, isAuthenticated, isLoadingAuth]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4" dir="rtl">
      <div className="bg-white rounded-2xl shadow-md p-10 max-w-md w-full text-center">
        <div className="w-12 h-12 bg-purple-600 rounded-xl flex items-center justify-center mx-auto mb-5">
          <span className="text-white text-xl font-bold">OTX</span>
        </div>

        {status === 'idle' || status === 'loading' ? (
          <>
            <h1 className="text-xl font-bold text-gray-900 mb-2">מצטרף לארגון...</h1>
            <p className="text-gray-500 text-sm mb-6">אנא המתן</p>
            <div className="w-8 h-8 border-4 border-purple-100 border-t-purple-600 rounded-full animate-spin mx-auto" />
          </>
        ) : status === 'success' ? (
          <>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">ברוך הבא לארגון!</h1>
            <p className="text-gray-500 text-sm">מעביר אותך לדשבורד...</p>
          </>
        ) : (
          <>
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">שגיאה בהצטרפות</h1>
            <p className="text-red-500 text-sm mb-6">{errorMsg}</p>
            <button
              onClick={() => navigate('/')}
              className="bg-purple-600 text-white px-6 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 transition-colors"
            >
              חזרה לדף הבית
            </button>
          </>
        )}
      </div>
    </div>
  );
}
