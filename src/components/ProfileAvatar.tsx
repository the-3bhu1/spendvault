import { useFinance } from '../FinanceContext';

interface ProfileAvatarProps {
  size?: number;
  className?: string;
  onClick?: () => void;
  isActive?: boolean;
}

export default function ProfileAvatar({ size = 40, className = '', onClick, isActive = false }: ProfileAvatarProps) {
  const { data } = useFinance();
  const userName = data.user?.name || 'User';
  const profileImage = data.user?.profileImage;

  const getInitials = (name: string) => {
    const parts = name.split(' ');
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return name.slice(0, 2).toUpperCase();
  };

  const initials = getInitials(userName);

  const containerStyle: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: onClick ? 'pointer' : 'default',
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
    border: isActive ? '2px solid var(--accent)' : '2px solid transparent',
    boxShadow: isActive ? '0 0 12px var(--accent-glow)' : 'none',
    transition: 'all 0.2s ease',
    ...(!profileImage && {
      background: 'linear-gradient(135deg, var(--accent), #eab308)',
      color: '#fff',
      fontWeight: 700,
      fontSize: `${size * 0.4}px`,
    })
  };

  return (
    <div style={containerStyle} className={className} onClick={onClick}>
      {profileImage ? (
        <img 
          src={profileImage} 
          alt={userName} 
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        <span>{initials}</span>
      )}
    </div>
  );
}
