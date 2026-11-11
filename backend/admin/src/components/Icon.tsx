import {
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  Eye,
  Folder,
  Globe,
  Heart,
  Image,
  KeyRound,
  Layers,
  Mail,
  Menu,
  MessageCircle,
  Palette,
  Pencil,
  RotateCcw,
  Search,
  Shield,
  Star,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'

const icons = {
  users: Users,
  key: KeyRound,
  trash: Trash2,
  bell: Bell,
  mail: Mail,
  menu: Menu,
  edit: Pencil,
  shield: Shield,
  x: X,
  layers: Layers,
  image: Image,
  'message-circle': MessageCircle,
  heart: Heart,
  star: Star,
  'rotate-ccw': RotateCcw,
  'chevron-down': ChevronDown,
  'user-plus': UserPlus,
  'chevron-right': ChevronRight,
  globe: Globe,
  folder: Folder,
  check: Check,
  clock: Clock,
  eye: Eye,
  search: Search,
  palette: Palette,
  download: Download,
} as const

export type IconName = keyof typeof icons

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const Component = icons[name]
  return <Component size={size} aria-hidden="true" />
}
