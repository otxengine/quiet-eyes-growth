// endpoint הוסר — שימש לבדיקות בלבד ואין לחשוף אותו בסביבת ייצור
Deno.serve(() => Response.json({ error: 'Not found' }, { status: 404 }));
