package com.NormaOne.backend.controllers;

import java.util.List;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.NormaOne.backend.dto.modules.ModuleResponse;

/**
 * The static module catalog: the six application modules and the permissions defined for each.
 * Readable by any active account (the any-role rule in SecurityConfig); it holds no tenant or user
 * data. What a given user may use is in GET /api/users/me (modules, modulePermissions).
 */
@RestController
@RequestMapping("/api/modules")
public class ModuleController {

    @GetMapping
    public ResponseEntity<List<ModuleResponse>> catalogue() {
        return ResponseEntity.ok(ModuleResponse.catalogue());
    }
}
