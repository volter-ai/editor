def can_build(env, platform):
    env.module_add_dependencies("gdscript_frontend_exporter", ["gdscript"])
    return True


def configure(env):
    pass
