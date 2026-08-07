'use client';
import React, { createContext, useContext, useState, useEffect } from 'react';
import { useBodyScrollLock } from '@/common/hooks/use-body-scroll-lock';
import { useIsDesktop } from '@/common/hooks/use-media-query';

type SidebarContextType = {
  isExpanded: boolean;
  isMobileOpen: boolean;
  isHovered: boolean;
  openSubmenu: string | null;
  toggleSidebar: () => void;
  toggleMobileSidebar: () => void;
  closeMobileSidebar: () => void;
  setIsHovered: (isHovered: boolean) => void;
  setOpenSubmenu: (item: string | null) => void;
  toggleSubmenu: (item: string) => void;
};

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export const useSidebar = () => {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return context;
};

export const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const isDesktop = useIsDesktop();

  useEffect(() => {
    if (isDesktop) setIsMobileOpen(false);
  }, [isDesktop]);

  useBodyScrollLock(isMobileOpen);

  const toggleSidebar = () => setIsExpanded((prev) => !prev);
  const toggleMobileSidebar = () => setIsMobileOpen((prev) => !prev);
  const closeMobileSidebar = () => setIsMobileOpen(false);
  const toggleSubmenu = (item: string) => setOpenSubmenu((prev) => (prev === item ? null : item));

  return (
    <SidebarContext.Provider
      value={{
        isExpanded: isDesktop ? isExpanded : false,
        isMobileOpen,
        isHovered,
        openSubmenu,
        toggleSidebar,
        toggleMobileSidebar,
        closeMobileSidebar,
        setIsHovered,
        setOpenSubmenu,
        toggleSubmenu,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
};
