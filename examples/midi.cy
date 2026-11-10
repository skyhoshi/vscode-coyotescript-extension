// Open this file with the CoyoteScript language mode.
%last_note = 60
runscript default greet

script greet public
    print "CoyoteScript is ready"

event midi note
    $velocity = ($trigger velocity)
    if $velocity > 0
        %last_note = ($trigger note)
        print "Note %last_note at velocity $velocity"
    else
        print Note released

event uirefreshed
    translationparameter label (textbox "Label" "Text shown by the script")
