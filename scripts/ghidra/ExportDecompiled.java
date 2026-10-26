// Headless export: decompiled C for every function, plus imports, exports and strings.
// Usage: analyzeHeadless <proj> <name> -import <bin> -postScript ExportDecompiled.java <outDir>
import ghidra.app.decompiler.*;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.data.StringDataInstance;
import ghidra.program.model.listing.*;
import ghidra.program.model.symbol.*;
import java.io.*;

public class ExportDecompiled extends GhidraScript {
    @Override
    public void run() throws Exception {
        File out = new File(getScriptArgs()[0]);
        out.mkdirs();
        String name = currentProgram.getName();

        DecompInterface ifc = new DecompInterface();
        ifc.openProgram(currentProgram);
        int ok = 0, failed = 0;
        try (PrintWriter c = new PrintWriter(new File(out, name + ".c"), "UTF-8")) {
            c.println("// Ghidra decompilation of " + name + " (" + currentProgram.getLanguageID() + ")");
            for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
                if (monitor.isCancelled()) break;
                if (f.isThunk() || f.isExternal()) continue;
                DecompileResults r = ifc.decompileFunction(f, 60, monitor);
                c.println("\n// " + f.getEntryPoint() + "  " + f.getName(true));
                if (r != null && r.decompileCompleted()) {
                    c.println(r.getDecompiledFunction().getC());
                    ok++;
                } else {
                    c.println("// decompile failed: " + (r == null ? "null" : r.getErrorMessage()));
                    failed++;
                }
            }
        }
        ifc.dispose();

        try (PrintWriter s = new PrintWriter(new File(out, name + ".symbols.txt"), "UTF-8")) {
            SymbolTable st = currentProgram.getSymbolTable();
            s.println("## imports");
            for (Symbol sym : st.getExternalSymbols()) s.println(sym.getParentNamespace() + "::" + sym.getName());
            s.println("\n## exports / entry points");
            var it = st.getExternalEntryPointIterator();
            while (it.hasNext()) {
                Symbol sym = st.getPrimarySymbol(it.next());
                if (sym != null) s.println(sym.getAddress() + "  " + sym.getName(true));
            }
        }

        try (PrintWriter s = new PrintWriter(new File(out, name + ".strings.txt"), "UTF-8")) {
            for (Data d : currentProgram.getListing().getDefinedData(true)) {
                StringDataInstance sdi = StringDataInstance.getStringDataInstance(d);
                if (sdi != StringDataInstance.NULL_INSTANCE) {
                    String v = sdi.getStringValue();
                    if (v != null && v.length() >= 4) s.println(d.getAddress() + "  " + v.replace("\n", "\\n"));
                }
            }
        }
        println("ExportDecompiled " + name + ": " + ok + " functions, " + failed + " failed");
    }
}
