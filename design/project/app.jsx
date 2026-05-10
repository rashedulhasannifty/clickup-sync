// Main App entry: composes shell + routes + tweaks

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const { path, navigate } = useRoute();
  const [collapsed, setCollapsed] = React.useState(tweaks.sidebarStyle === 'collapsed');
  const [cmdOpen, setCmdOpen] = React.useState(false);
  const filters = useGlobalFilters();

  // Apply theme + accent + density to root
  React.useEffect(() => {
    const accent = ACCENT_PRESETS[tweaks.accent] || ACCENT_PRESETS.gradient;
    const root = document.documentElement;
    root.dataset.theme = tweaks.theme;
    root.dataset.density = tweaks.density;
    root.style.setProperty('--accent', accent.accent);
    root.style.setProperty('--accent-hover', accent.accentHover);
    root.style.setProperty('--accent-soft', accent.accentSoft);
    root.style.setProperty('--accent-strong', accent.accentStrong);
    root.style.setProperty('--accent-grad', accent.grad);
  }, [tweaks.theme, tweaks.density, tweaks.accent]);

  // Cmd+K
  React.useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdOpen(v => !v); }
      if (e.key === 'Escape') setCmdOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleTheme = () => setTweak('theme', tweaks.theme === 'light' ? 'dark' : 'light');

  // Route → page
  let page = null;
  if (path.startsWith('/overview') || path === '/') page = <window.OverviewPage navigate={navigate}/>;
  else if (path.startsWith('/tasks')) page = <window.TasksPage navigate={navigate} routePath={path}/>;
  else if (path.startsWith('/time-entries')) page = <window.TimeEntriesPage navigate={navigate}/>;
  else if (path.startsWith('/missing-rates')) page = <window.MissingRatesPage navigate={navigate}/>;
  else if (path.startsWith('/assignee-rates')) page = <window.AssigneeRatesPage navigate={navigate}/>;
  else if (path.startsWith('/spaces')) page = <window.SpacesPage navigate={navigate}/>;
  else if (path.startsWith('/sync-logs')) page = <window.SyncLogsPage navigate={navigate}/>;
  else if (path.startsWith('/settings')) page = <window.SettingsPage navigate={navigate}/>;
  else if (path.startsWith('/canvas')) page = <window.VariationsCanvas/>;
  else page = <window.OverviewPage navigate={navigate}/>;

  return (
    <FilterContext.Provider value={filters}>
      <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--page-bg)', color: 'var(--text)' }}>
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(c => !c)} currentPath={path} navigate={navigate}/>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <TopBar onToggleTheme={toggleTheme} theme={tweaks.theme} onOpenCommand={() => setCmdOpen(true)} navigate={navigate}/>
          <main style={{ flex: 1, padding: '20px 24px 60px', maxWidth: 1480, width: '100%', margin: '0 auto' }}>
            {page}
          </main>
        </div>
        <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} navigate={navigate}/>

        <TweaksPanel>
          <TweakSection label="Theme"/>
          <TweakRadio label="Mode" value={tweaks.theme} options={['light', 'dark']} onChange={v => setTweak('theme', v)}/>
          <TweakColor label="Accent" value={tweaks.accent}
            options={['gradient', 'purple', 'slate', 'blue']}
            optionToColor={k => ACCENT_PRESETS[k].accent}
            onChange={v => setTweak('accent', v)}/>
          <TweakSection label="Layout"/>
          <TweakSelect label="Density" value={tweaks.density}
            options={[
              { value: 'compact', label: 'Compact (Linear-style)' },
              { value: 'comfortable', label: 'Comfortable (Notion-style)' },
            ]}
            onChange={v => setTweak('density', v)}/>
          <TweakRadio label="Sidebar" value={tweaks.sidebarStyle}
            options={['expanded', 'collapsed']}
            onChange={v => { setTweak('sidebarStyle', v); setCollapsed(v === 'collapsed'); }}/>
          <TweakSection label="Welcome banner"/>
          <TweakToggle label="Show welcome banner on Overview" value={tweaks.showWelcomeBanner} onChange={v => setTweak('showWelcomeBanner', v)}/>
          <TweakSection label="Variations canvas"/>
          <TweakButton onClick={() => navigate('/canvas')}>Open variations canvas →</TweakButton>
        </TweaksPanel>
      </div>
    </FilterContext.Provider>
  );
}

window.App = App;
