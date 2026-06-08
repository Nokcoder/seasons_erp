import { useAuth } from '../context/AuthContext';

interface CanProps {
  perform: string; // The exact permission string (e.g., "edit_transfer_header")
  children: React.ReactNode;
}

export default function Can({ perform, children }: CanProps) {
  const { user } = useAuth();
  
  // Assuming your backend sends the permissions array during login
  const userPermissions = user?.permissions || [];

  if (userPermissions.includes(perform)) {
    return <>{children}</>;
  }
  
  return null; // Renders absolutely nothing if they lack permission
}