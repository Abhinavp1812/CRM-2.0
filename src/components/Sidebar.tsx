"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import {
  HomeIcon,
  UserGroupIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  ArrowDownTrayIcon,
  NoSymbolIcon,
  Bars3Icon,
  XMarkIcon,
  ArrowRightOnRectangleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  UserCircleIcon,
  ExclamationTriangleIcon,
  QuestionMarkCircleIcon,
  ClipboardDocumentListIcon,
} from "@heroicons/react/24/outline";
import { signOut, useSession } from "next-auth/react";
import SelfLeaveButton from "./SelfLeaveButton";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

function LogoMark({ size }: { size: number }) {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-md"
      >
        <span className="text-white font-bold" style={{ fontSize: size * 0.38 }}>SL</span>
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logo.png"
      alt="Style Lounge"
      width={size}
      height={size}
      className="rounded-xl block flex-shrink-0 shadow-md"
      onError={() => setErr(true)}
    />
  );
}

export default function Sidebar() {
  const { data: session } = useSession();
  const userName = session?.user?.name || "User";
  const userRole = session?.user?.role;
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const photoUpdatedAt = session?.user?.photoUpdatedAt ?? 0;
  const photoSrc = photoUpdatedAt > 0 ? `/api/profile/photo?v=${photoUpdatedAt}` : null;

  const isSuperAdmin = session?.user?.id === "super-admin";

  const userNav: NavItem[] = [
    { label: "Followups", href: "/", icon: HomeIcon },
    { label: "Customers", href: "/customers", icon: UserGroupIcon },
  ];
  if (userRole === "AGENT") {
    userNav.push({ label: "My Stats", href: "/stats", icon: ChartBarIcon });
  }
  if (!isSuperAdmin) {
    userNav.push({ label: "Profile", href: "/profile", icon: UserCircleIcon });
  }
  if (userRole === "AGENT") {
    userNav.push({ label: "Help", href: "/help", icon: QuestionMarkCircleIcon });
  }

  const adminNav: NavItem[] = [
    { label: "Admin", href: "/admin", icon: Cog6ToothIcon },
    { label: "Imports", href: "/admin/imports", icon: ArrowDownTrayIcon },
    { label: "Closed", href: "/admin/closed-followups", icon: NoSymbolIcon },
    { label: "Team Stats", href: "/admin/stats", icon: ChartBarIcon },
    { label: "Reassign Log", href: "/admin/reassignment-log", icon: ClipboardDocumentListIcon },
    { label: "Danger Zone", href: "/admin/danger", icon: ExclamationTriangleIcon },
    { label: "Help", href: "/admin/help", icon: QuestionMarkCircleIcon },
  ];

  const isActive = (href: string) => {
    if (href === "/" || href === "/admin") return pathname === href;
    return pathname.startsWith(href);
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = isActive(item.href);
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 " +
          (active
            ? "bg-blue-600 text-white shadow-sm"
            : "text-slate-400 hover:bg-slate-800 hover:text-white")
        }
        title={collapsed ? item.label : undefined}
      >
        <Icon className="h-4.5 w-4.5 flex-shrink-0 h-5 w-5" />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  const avatar = userName.charAt(0).toUpperCase();
  const [photoErr, setPhotoErr] = useState(false);
  useEffect(() => { setPhotoErr(false); }, [photoSrc]);

  const AvatarCircle = ({ size = 8 }: { size?: number }) => {
    if (photoSrc && !photoErr) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoSrc}
          alt={userName}
          width={size * 4}
          height={size * 4}
          className={`w-${size} h-${size} rounded-full object-cover ring-2 ring-blue-500/50 flex-shrink-0`}
          onError={() => setPhotoErr(true)}
        />
      );
    }
    return (
      <div className={`w-${size} h-${size} rounded-full bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-md`}>
        {avatar}
      </div>
    );
  };

  const sidebarContent = (
    <aside
      className={
        "bg-slate-900 flex flex-col z-40 transition-all duration-200 " +
        "sticky top-0 h-screen " +
        (collapsed ? "w-16" : "w-60")
      }
    >
      {/* Logo + collapse toggle */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-slate-800 flex-shrink-0">
        {!collapsed ? (
          <>
            <div className="flex items-center gap-2.5">
              <LogoMark size={30} />
              <span className="font-bold text-white text-sm tracking-tight">Style Lounge</span>
            </div>
            <button
              onClick={() => setCollapsed(true)}
              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
              title="Collapse"
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </button>
          </>
        ) : (
          <button
            onClick={() => setCollapsed(false)}
            className="mx-auto"
            title="Expand"
          >
            <LogoMark size={30} />
          </button>
        )}
      </div>

      {/* User info */}
      <div className={"border-b border-slate-800 flex-shrink-0 " + (collapsed ? "py-3 flex justify-center" : "px-3 py-3")}>
        {collapsed ? (
          isSuperAdmin ? (
            <AvatarCircle size={8} />
          ) : (
            <Link href="/profile" title={userName}>
              <AvatarCircle size={8} />
            </Link>
          )
        ) : (
          <>
            {isSuperAdmin ? (
              <div className="flex items-center gap-2.5">
                <AvatarCircle size={8} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{userName}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">{userRole}</p>
                </div>
              </div>
            ) : (
              <Link href="/profile" className="flex items-center gap-2.5 group">
                <AvatarCircle size={8} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate group-hover:text-blue-400 transition-colors">{userName}</p>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">{userRole}</p>
                </div>
              </Link>
            )}
            {userRole === "AGENT" && (
              <div className="mt-2.5 pl-[42px]">
                <SelfLeaveButton role={userRole} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Navigation — scrollable */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {userNav.map(renderNavItem)}

        {userRole === "ADMIN" && (
          <>
            {collapsed
              ? <div className="my-3 border-t border-slate-800" />
              : (
                <div className="pt-5 pb-1.5 px-3">
                  <p className="text-[10px] font-semibold text-slate-600 uppercase tracking-widest">Admin</p>
                </div>
              )
            }
            {adminNav.map(renderNavItem)}
          </>
        )}
      </nav>

      {/* Sign out */}
      <div className="border-t border-slate-800 p-2 flex-shrink-0">
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-500 hover:bg-slate-800 hover:text-red-400 transition-colors"
          title={collapsed ? "Sign out" : undefined}
        >
          <ArrowRightOnRectangleIcon className="h-5 w-5 flex-shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(!mobileOpen)}
        className="md:hidden fixed top-3 left-3 z-50 p-2 bg-slate-900 rounded-lg shadow-lg border border-slate-700"
        aria-label="Open menu"
      >
        {mobileOpen ? <XMarkIcon className="h-5 w-5 text-white" /> : <Bars3Icon className="h-5 w-5 text-white" />}
      </button>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          className="md:hidden fixed inset-0 bg-black/60 z-30 backdrop-blur-sm"
        />
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:block flex-shrink-0">
        {sidebarContent}
      </div>

      {/* Mobile sidebar */}
      <div
        className={
          "md:hidden fixed inset-y-0 left-0 z-40 w-64 shadow-2xl transform transition-transform duration-300 " +
          (mobileOpen ? "translate-x-0" : "-translate-x-full")
        }
      >
        {sidebarContent}
      </div>
    </>
  );
}
