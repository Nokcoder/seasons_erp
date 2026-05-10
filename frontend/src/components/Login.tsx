import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { loginUser, registerUser } from '../services/api';

export default function Login() {
  const [isRegistering, setIsRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isRegistering) {
        await registerUser({ username, password, role: 'WAREHOUSE_STAFF' });
        // Auto-login after registration
        const data = await loginUser({ username, password });
        login(data.user, data.access_token);
        navigate('/');
      } else {
        const data = await loginUser({ username, password });
        login(data.user, data.access_token);
        navigate('/');
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col justify-center items-center">
      <div className="bg-white p-8 rounded-lg shadow-md w-96 border border-gray-200">
        <h2 className="text-2xl font-black text-blue-800 text-center mb-6">
          ERP System
        </h2>
        
        {error && <div className="bg-red-50 text-red-600 p-3 rounded mb-4 text-sm font-bold">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-bold text-gray-700">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-bold text-gray-700">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="mt-1 w-full p-2 border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500" />
          </div>
          
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white font-bold py-2 rounded hover:bg-blue-700 transition disabled:bg-gray-400">
            {loading ? 'Processing...' : (isRegistering ? 'Register Account' : 'Secure Login')}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button type="button" onClick={() => setIsRegistering(!isRegistering)} className="text-sm text-blue-600 hover:underline">
            {isRegistering ? 'Already have an account? Log in here.' : 'Need an account? Register here.'}
          </button>
        </div>
      </div>
    </div>
  );
}