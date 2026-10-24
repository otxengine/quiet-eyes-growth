-- Pin search_path on the public functions the Supabase advisor flags (function_search_path_mutable),
-- so what they resolve can't change with the caller's search_path. Their bodies only use public
-- tables and pg_catalog, so behaviour is unchanged; pg_temp goes last so a temp object can't shadow them.
-- The vector extension also sits in public (extension_in_public). It stays there for now: moving it
-- would change how every vector column and operator resolves.
alter function public.array_append_unique(text[], text)       set search_path = public, pg_temp;
alter function public.cleanup_agent_bus()                     set search_path = public, pg_temp;
alter function public.notify_agent_bus()                      set search_path = public, pg_temp;
alter function public.notify_competitor_change()              set search_path = public, pg_temp;
alter function public.notify_local_event()                    set search_path = public, pg_temp;
alter function public.notify_new_event()                      set search_path = public, pg_temp;
alter function public.notify_new_signal()                     set search_path = public, pg_temp;
alter function public.notify_signal_qualified()               set search_path = public, pg_temp;
alter function public.notify_trend_spike()                    set search_path = public, pg_temp;
alter function public.update_competitor_config_updated_at()   set search_path = public, pg_temp;
